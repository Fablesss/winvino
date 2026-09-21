"""Постоянный визуальный воркер сервиса: локатор бутылки + энкодер + индекс каталога.

Протокол — JSON по строке через stdin/stdout:
    вход:  {"id": 1, "path": "C:/.../photo.jpg"}
    выход: {"id": 1, "box": [x0, y0, x1, y1] (доли кадра), "box_source": "detector" | "fallback",
            "refs": [...имена файлов...] — только в ответе на {"id": 0, "cmd": "refs"},
            "sims": [...сходство с каждым референсом в порядке refs...], "ms": 240}
Первая строка stdout — {"ready": true, "model": ..., "refs": N}. Логи — в stderr.

    .venv-ml\\Scripts\\python.exe -m ml.worker [--checkpoint data/raw/model/checkpoints/ft1-best.pt]
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time

os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")

import numpy as np  # noqa: E402
import torch  # noqa: E402

from .common import load_catalog, load_rgb  # noqa: E402
from .eval_visual import load_encoder  # noqa: E402
from .locate import BottleLocator  # noqa: E402
from .retrieval import build_index  # noqa: E402
from .views import QUERY_VIEWS, query_views  # noqa: E402

# Стратегия «все виды запроса × оба вида референса» — лучшая на синтетике (eval_visual).
QUERY_WEIGHTS = np.array([1.0 for _ in QUERY_VIEWS], dtype=np.float32)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="siglip2-b16")
    ap.add_argument("--checkpoint", default=None)
    ap.add_argument("--device", default="cuda" if torch.cuda.is_available() else "cpu")
    args = ap.parse_args()

    device = torch.device(args.device)
    enc = load_encoder(args.model, args.checkpoint, device)
    tag = args.model
    if args.checkpoint:
        tag += "-" + torch.load(args.checkpoint, map_location="cpu").get("tag", "ft")
    index = build_index(enc, load_catalog(), tag)
    loc = BottleLocator(device)
    print(json.dumps({"ready": True, "model": tag, "refs": len(index.ref_names)}), flush=True)

    for line in sys.stdin:
        if not line.strip():
            continue
        req = json.loads(line)
        if req.get("cmd") == "refs":
            print(json.dumps({"id": req["id"], "refs": index.ref_names, "slugs": index.slugs}, ensure_ascii=False), flush=True)
            continue
        t0 = time.perf_counter()
        try:
            img = load_rgb(req["path"])
            img.thumbnail((1600, 1600))
            located = loc.target(img)
            box = located.box if located.source == "detector" else None
            q = enc.embed(query_views(img, box))
            sims = index.scores(q, QUERY_WEIGHTS)
            w, h = img.size
            bx = located.box
            resp = {
                "id": req["id"],
                "box": [round(bx[0] / w, 4), round(bx[1] / h, 4), round(bx[2] / w, 4), round(bx[3] / h, 4)],
                "box_source": located.source,
                "sims": [round(float(s), 4) for s in sims],
            }
        except Exception as err:
            resp = {"id": req["id"], "error": f"{type(err).__name__}: {err}"}
        resp["ms"] = round((time.perf_counter() - t0) * 1000)
        print(json.dumps(resp), flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
