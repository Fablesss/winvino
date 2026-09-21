"""Оценка визуального ретривала целиком: локатор + виды запроса + индекс каталога.

    .venv-ml\\Scripts\\python.exe -m ml.eval_visual --model siglip2-b16 [--checkpoint путь]

В отличие от bench_zeroshot, здесь нет «оракульной» рамки: запрос проходит тот же путь,
что в сервисе. Печатает метрики по стратегиям (какие виды запроса и референса брать)
на синтетике и на реальных фото.
"""
from __future__ import annotations

import argparse
import json
import time
from itertools import product

import numpy as np
import torch
from PIL import Image

from .backbones import Encoder
from .common import MODEL_DIR, load_catalog, load_rgb
from .evalset import REAL_DIR, build_synthetic, load_queries
from .evaluate import summarize
from .locate import BottleLocator
from .retrieval import build_index
from .views import QUERY_VIEWS, REF_VIEWS, query_views

# Стратегии: какие виды запроса участвуют и с каким весом.
STRATEGIES = {
    "full": {"full": 1.0},
    "center": {"center": 1.0},
    "box": {"box": 1.0},
    "box+label": {"box": 1.0, "box_label": 1.0},
    "all": {"box": 1.0, "box_label": 1.0, "center": 1.0, "full": 1.0},
    "all_w": {"box": 1.0, "box_label": 1.0, "center": 0.97, "full": 0.94},
}


def load_encoder(model: str, checkpoint: str | None, device: torch.device) -> Encoder:
    enc = Encoder(model)
    if checkpoint:
        state = torch.load(checkpoint, map_location="cpu")
        enc.net.load_state_dict(state["net"])
    return enc.to(device).eval()


def sim_tensors(enc: Encoder, loc: BottleLocator, index, images: list[Image.Image]) -> list[np.ndarray]:
    out = []
    for img in images:
        box = loc.target(img)
        q = enc.embed(query_views(img, box.box if box.source == "detector" else None))
        out.append(np.einsum("qd,rvd->rqv", q, index.emb))
    return out


def rank(sims: np.ndarray, ref_idx: int | None, qw: dict[str, float], rviews: tuple[str, ...]) -> int | None:
    if ref_idx is None:
        return None
    qi = [QUERY_VIEWS.index(k) for k in qw]
    ri = [REF_VIEWS.index(k) for k in rviews]
    w = np.array([qw[k] for k in qw])[None, :, None]
    s = (sims[:, qi][:, :, ri] * w).reshape(sims.shape[0], -1).max(axis=1)
    return int((s > s[ref_idx]).sum()) + 1


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="siglip2-b16")
    ap.add_argument("--checkpoint")
    ap.add_argument("--n", type=int, default=1000)
    ap.add_argument("--seed", type=int, default=1)
    args = ap.parse_args()

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    catalog = load_catalog()
    enc = load_encoder(args.model, args.checkpoint, device)
    tag = args.model + ("-" + torch.load(args.checkpoint, map_location="cpu").get("tag", "ft") if args.checkpoint else "")
    t0 = time.perf_counter()
    index = build_index(enc, catalog, tag)
    print(f"индекс {tag}: {index.emb.shape}, {time.perf_counter() - t0:.0f} с")
    pos = {n: i for i, n in enumerate(index.ref_names)}
    loc = BottleLocator(device)

    report = {"tag": tag}
    for set_name, queries in (
        ("synthetic", build_synthetic(catalog, args.n, args.seed)),
        ("real", [q for q in load_queries(REAL_DIR / "queries.jsonl") if q.target_image]),
    ):
        images = []
        for q in queries:
            im = load_rgb(q.file)
            im.thumbnail((1600, 1600))
            images.append(im)
        t0 = time.perf_counter()
        sims = sim_tensors(enc, loc, index, images)
        ms = (time.perf_counter() - t0) * 1000 / max(1, len(images))
        truth = [pos.get(q.target_image) for q in queries]
        res = {}
        for (sname, qw), rv in product(STRATEGIES.items(), (("bottle",), ("bottle", "label"))):
            ranks = [rank(s, t, qw, rv) for s, t in zip(sims, truth)]
            res[f"{sname}|ref:{'+'.join(rv)}"] = summarize(ranks)
        best = max(res, key=lambda k: (res[k].get("top1", 0), res[k].get("top5", 0)))
        report[set_name] = {"ms_per_query": round(ms), "strategies": res, "best": best}
        print(f"\n== {set_name} ({len(queries)} запросов, {ms:.0f} мс/запрос)")
        for k, v in res.items():
            print(f"  {k:34s} top1 {v.get('top1', 0):.3f}  top5 {v.get('top5', 0):.3f}  top20 {v.get('top20', 0):.3f}")
        if set_name == "real":
            k = "all_w|ref:bottle+label"
            ranks = [rank(s, t, STRATEGIES["all_w"], ("bottle", "label")) for s, t in zip(sims, truth)]
            report["real_ranks"] = {q.file.name: r for q, r in zip(queries, ranks)}
            print(f"  ранги ({k}):", report["real_ranks"])

    out = MODEL_DIR / "bench" / f"visual-{tag}-{int(time.time())}.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"→ {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
