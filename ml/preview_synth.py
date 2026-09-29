"""Картинка «эталон → синтетические кадры» для презентаций и разбора генератора.

`python -m ml.preview_synth --slugs massandra-muskatel-belyy --n 5`
→ data/raw/dataset/preview/synth-preview.png: строка на вино, слева студийный рендер
каталога, справа кадры `synth.make_scene` с тем же seed, что на обучении.
"""
from __future__ import annotations

import argparse
import random
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

from .common import DATASET_DIR, cutout, flatten, load_cached, load_catalog
from .synth import background_pool, make_scene

OUT_DIR = DATASET_DIR / "preview"
TILE = (240, 320)  # 3:4, как кадр генератора


def _fit(img: Image.Image, size: tuple[int, int], bg=(255, 255, 255)) -> Image.Image:
    out = Image.new("RGB", size, bg)
    c = img.copy()
    c.thumbnail(size, Image.LANCZOS)
    out.paste(c, ((size[0] - c.width) // 2, (size[1] - c.height) // 2))
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--slugs", nargs="*", default=[], help="слаги каталога; по умолчанию случайные")
    ap.add_argument("--rows", type=int, default=3, help="сколько вин, если слаги не заданы")
    ap.add_argument("--n", type=int, default=5, help="кадров на вино")
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--box", action="store_true", help="рисовать рамку цели, которую ищет локатор")
    ap.add_argument("--out", type=Path, default=OUT_DIR / "synth-preview.png")
    args = ap.parse_args()

    catalog = load_catalog()
    by_slug = {c.slug: c for c in catalog}
    if args.slugs:
        items = [by_slug[s] for s in args.slugs]
    else:
        items = random.Random(args.seed).sample(catalog, args.rows)

    pool = background_pool({c.image.name for c in catalog}, "train")
    rng = np.random.default_rng(args.seed)
    pad, cols = 8, args.n + 1
    sheet = Image.new("RGB", (cols * TILE[0] + (cols + 1) * pad,
                              len(items) * TILE[1] + (len(items) + 1) * pad), (245, 243, 238))

    for row, item in enumerate(items):
        y = pad + row * (TILE[1] + pad)
        target = cutout(load_cached(item.image))
        sheet.paste(_fit(flatten(target), TILE), (pad, y))
        neighbors = [cutout(load_cached(catalog[int(k)].image))
                     for k in rng.integers(0, len(catalog), 3)]
        for col in range(args.n):
            scene = make_scene(target, neighbors, rng, pool)
            img = scene.image
            if args.box:
                ImageDraw.Draw(img).rectangle(scene.box, outline=(80, 220, 120), width=3)
            sheet.paste(_fit(img, TILE, (20, 20, 20)),
                        (pad + (col + 1) * (TILE[0] + pad), y))
        print(f"{item.slug}: {item.title}")

    args.out.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(args.out)
    print(f"→ {args.out} ({sheet.width}×{sheet.height})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
