"""Дообучение визуальной башни SigLIP2 на синтетике «под полку».

    .venv-ml\\Scripts\\python.exe -m ml.train --epochs 12 --tag ft1

Каждый уникальный рендер — класс. Прототипы классов стартуют с zero-shot эмбеддингов
каталога, loss — CosFace по всем классам сразу: на каждом шаге модель отличает вино от
всех остальных, включая соседей по бренду с тем же дизайном этикетки.

Обучаются последние `--train-blocks` блоков, attention-pool и нормы. Первые блоки идут
без градиентов: на 4 ГБ GTX 1050 Ti иначе не помещается, а fp16 на Pascal медленнее fp32.

Запросы — `synth.make_scene` на train-фонах (eval-фоны и реальные тест-кадры исключены)
в тех же видах, что строит инференс (`views.query_views`). Часть сэмплов — сами виды
референса с лёгкой аугментацией: так эмбеддинги рендеров остаются рядом с прототипами,
и индекс, пересчитанный дообученной моделью, согласован с запросами.
"""
from __future__ import annotations

import argparse
import json
import math
import time

import numpy as np
import torch
import torch.nn.functional as F
from PIL import Image, ImageEnhance
from torch.utils.data import DataLoader, Dataset

from .backbones import Encoder
from .common import MODEL_DIR, cutout, letterbox, load_cached, load_catalog, load_rgb
from .eval_visual import STRATEGIES, rank, sim_tensors
from .evalset import REAL_DIR, build_synthetic, drop_excluded, load_queries, real_upload_names
from .evaluate import summarize
from .locate import BottleLocator
from .retrieval import build_index
from .synth import Scene, background_pool, make_scene
from .views import query_views, ref_views

QUERY_VIEW_P = {"box": 0.35, "box_label": 0.3, "center": 0.2, "full": 0.15}


class SceneSet(Dataset):
    """Бесконечный поток: индекс → (класс, свежая случайная сцена)."""

    def __init__(self, images: list, bg_pool: list, size: int, length: int, ref_p: float):
        self.images = images          # пути к рендерам, индекс = класс
        self.bg_pool = bg_pool
        self.size = size
        self.length = length
        self.ref_p = ref_p

    def __len__(self) -> int:
        return self.length

    def _bottle(self, k: int, max_side: int = 1024) -> Image.Image:
        return cutout(load_cached(self.images[k], max_side))

    def __getitem__(self, i: int):
        rng = np.random.default_rng((torch.initial_seed() + i * 7919) % 2**63)
        k = i % len(self.images)
        target = self._bottle(k)
        if rng.random() < self.ref_p:
            view = ref_views(target)[int(rng.integers(2))]
            view = ImageEnhance.Brightness(view).enhance(rng.uniform(0.8, 1.2))
            view = ImageEnhance.Contrast(view).enhance(rng.uniform(0.8, 1.2))
        else:
            # Соседи в кадре мелкие и частично за краем — хватает уменьшенной копии.
            neighbors = [self._bottle(int(j), 512) for j in rng.integers(0, len(self.images), 2)]
            scene: Scene = make_scene(target, neighbors, rng, self.bg_pool)
            # Рамка как от детектора: истинная с дрожанием границ.
            x0, y0, x1, y1 = scene.box
            bw, bh = x1 - x0, y1 - y0
            jb = (x0 + bw * rng.uniform(-0.06, 0.06), y0 + bh * rng.uniform(-0.04, 0.04),
                  x1 + bw * rng.uniform(-0.06, 0.06), y1 + bh * rng.uniform(-0.04, 0.04))
            views = query_views(scene.image, tuple(int(v) for v in jb))
            names = list(QUERY_VIEW_P)
            view = views[names.index(rng.choice(names, p=list(QUERY_VIEW_P.values())))]
        view = view if view.width >= 8 and view.height >= 8 else target.convert("RGB")
        arr = np.asarray(letterbox(view, self.size), dtype=np.float32) / 255.0
        return torch.from_numpy(arr).permute(2, 0, 1), k


def forward_split(enc: Encoder, x: torch.Tensor, train_blocks: int) -> torch.Tensor:
    """Прямой проход с замороженной головой сети без графа градиентов."""
    trunk = enc.net.trunk
    x = (x - enc.mean) / enc.std
    with torch.no_grad():
        x = trunk.patch_embed(x)
        x = trunk._pos_embed(x)
        x = trunk.patch_drop(x)
        x = trunk.norm_pre(x)
        for b in trunk.blocks[:-train_blocks]:
            x = b(x)
    for b in trunk.blocks[-train_blocks:]:
        x = b(x)
    x = trunk.norm(x)
    return F.normalize(trunk.forward_head(x), dim=-1)


def quick_eval(enc, loc, catalog, synth_q, real_q, tag) -> dict:
    enc.eval()
    index = build_index(enc, catalog, tag)
    pos = {n: i for i, n in enumerate(index.ref_names)}
    out = {}
    for name, qs in (("synthetic", synth_q), ("real", real_q)):
        imgs = []
        for q in qs:
            im = load_rgb(q.file)
            im.thumbnail((1600, 1600))
            imgs.append(im)
        sims = sim_tensors(enc, loc, index, imgs)
        ranks = [rank(s, pos.get(q.target_image), STRATEGIES["all"], ("bottle", "label")) for s, q in zip(sims, qs)]
        out[name] = summarize(ranks)
    enc.train()
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="siglip2-b16")
    ap.add_argument("--tag", default="ft1")
    ap.add_argument("--epochs", type=int, default=12)
    ap.add_argument("--per-class", type=int, default=2, help="сэмплов на класс за эпоху")
    ap.add_argument("--batch", type=int, default=24)
    ap.add_argument("--train-blocks", type=int, default=4)
    ap.add_argument("--lr", type=float, default=2e-5)
    ap.add_argument("--lr-proto", type=float, default=1e-3)
    ap.add_argument("--scale", type=float, default=30.0)
    ap.add_argument("--margin", type=float, default=0.2)
    ap.add_argument("--ref-p", type=float, default=0.2)
    ap.add_argument("--workers", type=int, default=3)
    ap.add_argument("--eval-every", type=int, default=2)
    ap.add_argument("--eval-n", type=int, default=300)
    args = ap.parse_args()

    torch.manual_seed(0)
    device = torch.device("cuda")
    catalog = load_catalog()
    enc = Encoder(args.model).to(device)

    # Прототипы = zero-shot эмбеддинги референсов (среднее по видам).
    zs = build_index(enc.eval(), catalog, args.model)
    protos = torch.tensor(zs.emb.mean(axis=1))
    protos = torch.nn.Parameter(F.normalize(protos, dim=-1).to(device))
    item_by_image = {c.image.name: c for c in catalog}
    images = [item_by_image[n].image for n in zs.ref_names]

    for p in enc.parameters():
        p.requires_grad = False
    trunk = enc.net.trunk
    trainable = list(trunk.blocks[-args.train_blocks:]) + [trunk.norm, trunk.attn_pool, trunk.fc_norm]
    params = [p for m in trainable for p in m.parameters()]
    for p in params:
        p.requires_grad = True
    print(f"обучаемых параметров: {sum(p.numel() for p in params) / 1e6:.1f}M, классов: {len(images)}")

    exclude = {c.image.name for c in catalog} | real_upload_names()
    ds = SceneSet(images, background_pool(exclude, "train"), enc.size, len(images) * args.per_class, args.ref_p)
    dl = DataLoader(ds, batch_size=args.batch, shuffle=True, num_workers=args.workers,
                    persistent_workers=args.workers > 0, drop_last=True)

    opt = torch.optim.AdamW([
        {"params": params, "lr": args.lr, "weight_decay": 0.05},
        {"params": [protos], "lr": args.lr_proto, "weight_decay": 0.0},
    ])
    total = args.epochs * len(dl)
    warmup = min(300, total // 10)
    sched = torch.optim.lr_scheduler.LambdaLR(
        opt, lambda s: (s + 1) / warmup if s < warmup else 0.5 * (1 + math.cos(math.pi * (s - warmup) / max(1, total - warmup))))

    loc = BottleLocator(device)
    synth_q = drop_excluded(build_synthetic(catalog, 1000, 1)[: args.eval_n])
    real_q = drop_excluded([q for q in load_queries(REAL_DIR / "queries.jsonl") if q.target_image])
    out_dir = MODEL_DIR / "checkpoints"
    out_dir.mkdir(parents=True, exist_ok=True)
    log_path = out_dir / f"{args.tag}.log.jsonl"

    base = quick_eval(enc, loc, catalog, synth_q, real_q, f"{args.model}")
    print("до обучения:", base)
    best = base["synthetic"]["top1"]
    enc.train()
    step = 0
    for epoch in range(1, args.epochs + 1):
        t0 = time.perf_counter()
        losses, accs = [], []
        for x, y in dl:
            x, y = x.to(device, non_blocking=True), y.to(device)
            emb = forward_split(enc, x, args.train_blocks)
            cos = emb @ F.normalize(protos, dim=-1).T
            onehot = F.one_hot(y, cos.shape[1]).float()
            loss = F.cross_entropy(args.scale * (cos - args.margin * onehot), y)
            opt.zero_grad(set_to_none=True)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(params, 1.0)
            opt.step()
            sched.step()
            step += 1
            losses.append(loss.item())
            accs.append((cos.argmax(1) == y).float().mean().item())
            if step % 50 == 0:
                print(f"  эпоха {epoch} шаг {step}/{total} loss {np.mean(losses[-50:]):.3f} acc {np.mean(accs[-50:]):.3f}")
        rec = {"epoch": epoch, "loss": round(float(np.mean(losses)), 4), "train_acc": round(float(np.mean(accs)), 4),
               "minutes": round((time.perf_counter() - t0) / 60, 1)}
        if epoch % args.eval_every == 0 or epoch == args.epochs:
            ev = quick_eval(enc, loc, catalog, synth_q, real_q, f"{args.model}-{args.tag}-e{epoch}")
            rec.update(ev)
            state = {"net": enc.net.state_dict(), "tag": f"{args.tag}-e{epoch}", "model": args.model, "eval": ev}
            torch.save(state, out_dir / f"{args.tag}-last.pt")
            if ev["synthetic"]["top1"] > best:
                best = ev["synthetic"]["top1"]
                torch.save(state, out_dir / f"{args.tag}-best.pt")
                rec["best"] = True
        print(json.dumps(rec, ensure_ascii=False))
        with log_path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
