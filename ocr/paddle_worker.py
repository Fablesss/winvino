"""Постоянный OCR-воркер для сервиса распознавания: модели грузятся один раз.

Протокол — JSON по строке через stdin/stdout:
    вход:  {"id": 1, "path": "C:/.../photo.jpg", "box": [x0, y0, x1, y1] | null}
           box — рамка бутылки в долях кадра (0..1) после EXIF-поворота;
    выход: {"id": 1, "text": "...", "lines": [{"text", "score"}], "ms": 812}
Первая строка stdout — {"ready": true}. Логи — только в stderr.

    .venv-ocr\\Scripts\\python.exe ocr/paddle_worker.py
"""
from __future__ import annotations

import argparse
import json
import sys
import time

import numpy as np
from PIL import Image, ImageOps

from paddle_ocr import build_ocr, extract_lines

# Детектор PP-OCRv5 внутри всё равно ужимает кадр; 1600 по длинной стороне — баланс
# между мелким текстом этикетки и временем (~1 с на CPU i5-4440).
MAX_SIDE = 1600


def load_crop(path: str, box: list[float] | None) -> np.ndarray:
    with Image.open(path) as im:
        im = ImageOps.exif_transpose(im)
        if im.mode in ("RGBA", "LA", "P"):
            im = im.convert("RGBA")
            bg = Image.new("RGBA", im.size, (255, 255, 255, 255))
            im = Image.alpha_composite(bg, im)
        im = im.convert("RGB")
    if box:
        w, h = im.size
        x0, y0, x1, y1 = box
        pad_x, pad_y = (x1 - x0) * 0.06, (y1 - y0) * 0.03
        crop = (max(0, int((x0 - pad_x) * w)), max(0, int((y0 - pad_y) * h)),
                min(w, int((x1 + pad_x) * w)), min(h, int((y1 + pad_y) * h)))
        if crop[2] - crop[0] > 32 and crop[3] - crop[1] > 32:
            im = im.crop(crop)
    if max(im.size) > MAX_SIDE:
        im.thumbnail((MAX_SIDE, MAX_SIDE), Image.LANCZOS)
    return np.asarray(im)[:, :, ::-1].copy()  # RGB → BGR, как ждёт PaddleOCR


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--det", choices=["mobile", "server"], default="mobile")
    ap.add_argument("--rec", default="eslav_PP-OCRv5_mobile_rec")
    ap.add_argument("--threads", type=int, default=4)
    ap.add_argument("--no-mkldnn", action="store_true")
    args = ap.parse_args()

    ocr = build_ocr(args)
    print(json.dumps({"ready": True}), flush=True)
    for line in sys.stdin:
        if not line.strip():
            continue
        req = json.loads(line)
        t0 = time.perf_counter()
        try:
            img = load_crop(req["path"], req.get("box"))
            results = ocr.predict(img)
            lines = extract_lines(results[0]) if results else []
            resp = {"id": req["id"], "text": " ".join(l["text"] for l in lines), "lines": lines}
        except Exception as err:  # один битый кадр не должен ронять воркер
            resp = {"id": req["id"], "text": "", "lines": [], "error": f"{type(err).__name__}: {err}"}
        resp["ms"] = round((time.perf_counter() - t0) * 1000)
        print(json.dumps(resp, ensure_ascii=False), flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
