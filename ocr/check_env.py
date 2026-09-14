"""Проверка окружения PaddleOCR: версии, сборка без CUDA, декодирование webp с альфой."""
import glob
import sys

import cv2
import numpy as np
import paddle
import paddleocr

print("python   ", sys.version.split()[0])
print("paddle   ", paddle.__version__, "| собран с CUDA:", paddle.device.is_compiled_with_cuda())
print("paddleocr", paddleocr.__version__)
print("opencv   ", cv2.__version__)

files = sorted(glob.glob("data/raw/renders/*.webp"))
print("рендеров в кеше:", len(files))
if files:
    img = cv2.imdecode(np.fromfile(files[0], dtype=np.uint8), cv2.IMREAD_UNCHANGED)
    print("webp:", files[0], "->", None if img is None else img.shape, "(4 канала = альфа на месте)")
