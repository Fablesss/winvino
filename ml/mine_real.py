"""Поиск реальных фото с бутылками каталога среди прочих файлов uploads.

В дампе ~4 тыс. картинок, которые не являются рендерами: пресс-фото, мероприятия,
кадры из телеграм-каналов виноделен. Часть из них — бутылки из каталога в живой
обстановке, то есть готовый реальный тестовый набор, если подтвердить эталон глазами.

Скрипт только предлагает кандидатов (топ-5 по SigLIP2 на полном кадре и центральном
кропе) и собирает контактные листы «фото | топ-3 рендера» для ручной проверки.
Подтверждённые кадры вносятся в `data/raw/dataset/real/queries.jsonl` руками.

    .venv-ml\\Scripts\\python.exe -m ml.mine_real --top 120
"""
from __future__ import annotations

import argparse
import json

import numpy as np
import torch
from PIL import Image, ImageDraw

from .backbones import Encoder
from .common import DATASET_DIR, cutout, flatten, load_cached, load_catalog
from .synth import UPLOADS_DIR, BG_EXT

OUT_DIR = DATASET_DIR / "real" / "mining"


def is_studio(img: Image.Image) -> bool:
    """Рендер, а не фото: прозрачный фон или почти белая рамка по краям."""
    arr = np.asarray(img.convert("RGBA"))
    if arr[..., 3].min() < 250:
        return True
    rgb = arr[..., :3]
    border = np.concatenate([rgb[0], rgb[-1], rgb[:, 0], rgb[:, -1]])
    return (border.min(axis=1) > 235).mean() > 0.9


def write_sheets(rows: list[dict], refs: dict, top: int) -> None:
    """Листы: строка = фото + три лучших рендера, по 6 строк на лист."""
    for old in OUT_DIR.glob("sheet_*.jpg"):
        old.unlink()
    cell = 260
    per_sheet = 6
    for s in range(0, min(top, len(rows)), per_sheet):
        chunk = rows[s: s + per_sheet]
        sheet = Image.new("RGB", (cell * 4, cell * len(chunk)), "white")
        draw = ImageDraw.Draw(sheet)
        for r_i, r in enumerate(chunk):
            tiles = [load_cached(UPLOADS_DIR / r["file"]).convert("RGB")]
            tiles += [flatten(load_cached(refs[t["image"]].image)) for t in r["top5"][:3]]
            for c_i, t in enumerate(tiles):
                t = t.copy()
                t.thumbnail((cell - 6, cell - 22))
                sheet.paste(t, (c_i * cell + 3, r_i * cell + 3))
            draw.text((3, r_i * cell + cell - 18), f"#{s + r_i} {r['file'][:40]} {r['top1_sim']:.3f}", fill="red")
            for c_i, t in enumerate(r["top5"][:3], 1):
                draw.text((c_i * cell + 3, r_i * cell + cell - 18), t["slug"][:38], fill="blue")
        sheet.save(OUT_DIR / f"sheet_{s // per_sheet:03d}.jpg", quality=80)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="siglip2-b16")
    ap.add_argument("--top", type=int, default=120, help="сколько самых уверенных кандидатов вынести на листы")
    ap.add_argument("--sheets-only", action="store_true", help="пересобрать листы из candidates.jsonl без эмбеддингов")
    ap.add_argument("--max-sim", type=float, default=0.95, help="выше — почти-дубликат рендера, а не фото")
    args = ap.parse_args()

    catalog = load_catalog()
    refs = {}
    for c in catalog:
        refs.setdefault(c.image.name, c)
    ref_names = sorted(refs)

    if args.sheets_only:
        rows = [json.loads(l) for l in (OUT_DIR / "candidates.jsonl").read_text(encoding="utf-8").splitlines() if l]
        rows = [r for r in rows if r["top1_sim"] < args.max_sim]
        rows = [r for r in rows if not is_studio(load_cached(UPLOADS_DIR / r["file"]))]
        (OUT_DIR / "photos.jsonl").write_text("\n".join(json.dumps(r, ensure_ascii=False) for r in rows) + "\n", encoding="utf-8")
        print(f"фото (не рендеры, sim < {args.max_sim}): {len(rows)}")
        write_sheets(rows, refs, args.top)
        return 0
    exclude = set(ref_names)
    photos = [p for p in sorted(UPLOADS_DIR.iterdir())
              if p.suffix.lower() in BG_EXT and p.name not in exclude
              and not p.name.startswith(("thumbnail_", "small_", "medium_", "large_"))]
    print(f"референсов {len(ref_names)}, фото-кандидатов {len(photos)}")

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    enc = Encoder(args.model).to(device).eval()
    R = enc.embed([flatten(cutout(load_cached(refs[n].image))) for n in ref_names])

    rows = []
    batch = 64
    for i in range(0, len(photos), batch):
        imgs, names = [], []
        for p in photos[i: i + batch]:
            try:
                im = load_cached(p).convert("RGB")
            except Exception:
                continue
            if min(im.size) < 200:
                continue
            w, h = im.size
            imgs += [im, im.crop((int(w * 0.2), int(h * 0.05), int(w * 0.8), int(h * 0.95)))]
            names.append(p.name)
        if not imgs:
            continue
        E = enc.embed(imgs)
        S = (E @ R.T).reshape(len(names), 2, -1).max(axis=1)
        for name, row in zip(names, S):
            top = np.argsort(-row)[:5]
            rows.append({
                "file": name,
                "top1_sim": round(float(row[top[0]]), 4),
                "margin": round(float(row[top[0]] - row[top[1]]), 4),
                "top5": [{"image": ref_names[j], "slug": refs[ref_names[j]].slug, "sim": round(float(row[j]), 4)} for j in top],
            })
        print(f"  {min(i + batch, len(photos))}/{len(photos)}")

    rows.sort(key=lambda r: -r["top1_sim"])
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / "candidates.jsonl").write_text("\n".join(json.dumps(r, ensure_ascii=False) for r in rows) + "\n", encoding="utf-8")

    write_sheets(rows, refs, args.top)
    print(f"→ {OUT_DIR}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
