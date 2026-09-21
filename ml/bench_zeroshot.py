"""Сравнение предобученных энкодеров без дообучения: какой лучше находит бутылку по кадру.

    .venv-ml\\Scripts\\python.exe -m ml.bench_zeroshot --models dinov2-s clip-b16 siglip2-b16 --n 1000

Меряет на синтетике (кроп по известной рамке и полный кадр без детектора) и печатает
топ-5 по реальным фото из `data/raw/dataset/real/`.
"""
from __future__ import annotations

import argparse
import json
import time

import numpy as np
import torch
from PIL import Image

from .backbones import Encoder
from .common import DATASET_DIR, MODEL_DIR, cutout, flatten, load_cached, load_catalog, load_rgb
from .evalset import REAL_DIR, build_synthetic, load_queries, oracle_crop
from .evaluate import rank_of_truth, summarize

REF_BACKGROUNDS = [(255, 255, 255), (128, 128, 128), (25, 25, 25)]


def center_crop(img: Image.Image) -> Image.Image:
    w, h = img.size
    return img.crop((int(w * 0.2), int(h * 0.05), int(w * 0.8), int(h * 0.95)))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--models", nargs="+", default=["dinov2-s", "clip-b16", "siglip2-b16"])
    ap.add_argument("--n", type=int, default=1000)
    ap.add_argument("--seed", type=int, default=1)
    args = ap.parse_args()

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    catalog = load_catalog()
    refs: dict[str, object] = {}
    for c in catalog:
        refs.setdefault(c.image.name, c)
    ref_names = sorted(refs)
    slugs_by_image: dict[str, list[str]] = {}
    for c in catalog:
        slugs_by_image.setdefault(c.image.name, []).append(c.slug)

    t0 = time.perf_counter()
    cutouts = [cutout(load_cached(refs[n].image)) for n in ref_names]
    print(f"референсов: {len(ref_names)}, загрузка {time.perf_counter() - t0:.0f} с")
    queries = build_synthetic(catalog, args.n, args.seed)
    print(f"синтетических запросов: {len(queries)}")
    q_crops = [oracle_crop(q, i) for i, q in enumerate(queries)]
    q_scenes = [Image.open(q.file).convert("RGB") for q in queries]
    truth = [q.target_image for q in queries]

    real = load_queries(REAL_DIR / "queries.jsonl")
    real_imgs = []
    for q in real:
        im = load_rgb(q.file)
        im.thumbnail((1024, 1024))
        real_imgs.append(im)

    results = {}
    for key in args.models:
        t0 = time.perf_counter()
        enc = Encoder(key).to(device).eval()
        per_bg = [enc.embed([flatten(c, bg) for c in cutouts]) for bg in REF_BACKGROUNDS]
        ref_white = per_bg[0]
        ref_multi = np.mean(per_bg, axis=0)
        ref_multi /= np.linalg.norm(ref_multi, axis=1, keepdims=True)
        e_crop = enc.embed(q_crops)
        e_scene = enc.embed(q_scenes)
        res = {}
        for ref_kind, R in (("white", ref_white), ("multi", ref_multi)):
            res[f"crop/{ref_kind}"] = summarize(rank_of_truth(e_crop @ R.T, ref_names, truth))
            res[f"scene/{ref_kind}"] = summarize(rank_of_truth(e_scene @ R.T, ref_names, truth))

        real_report = []
        for view_name, view in (("full", lambda x: x), ("center", center_crop)):
            e_real = enc.embed([view(im) for im in real_imgs])
            sims = e_real @ ref_multi.T
            ranks = rank_of_truth(sims, ref_names, [q.target_image for q in real])
            for q, row, rank in zip(real, sims, ranks):
                top = np.argsort(-row)[:5]
                real_report.append({
                    "file": q.file.name, "view": view_name, "truth_rank": rank,
                    "top5": [(slugs_by_image[ref_names[j]][0], round(float(row[j]), 3)) for j in top],
                })
        res["real"] = real_report
        res["seconds"] = round(time.perf_counter() - t0)
        results[key] = res
        print(json.dumps({key: {k: v for k, v in res.items() if k != "real"}}, ensure_ascii=False))
        for r in real_report:
            print("   ", r["file"], r["view"], "rank:", r["truth_rank"], r["top5"][:3])
        del enc
        torch.cuda.empty_cache()

    out = MODEL_DIR / "bench" / f"zeroshot-{int(time.time())}.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(results, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"→ {out.relative_to(DATASET_DIR.parent.parent.parent)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
