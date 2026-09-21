"""Виды (кропы) запроса и референса для ретривала.

Один эмбеддинг на картинку плохо переживает разницу масштабов: на крупном плане
этикетка занимает весь кадр, а у рендера — треть бутылки. Поэтому и запрос, и
референс представлены несколькими видами, сходство пары = максимум по видам.
"""
from __future__ import annotations

from PIL import Image

from .common import flatten

# Этикетка у рендеров обычно на 40–95% высоты бутылки (горлышко и плечи сверху).
REF_VIEWS = ("bottle", "label")


def ref_views(bottle_rgba: Image.Image) -> list[Image.Image]:
    """`bottle_rgba` — вырезанная бутылка (`common.cutout`), фон белый как у рендеров."""
    full = flatten(bottle_rgba)
    w, h = full.size
    label = full.crop((0, int(h * 0.38), w, h)) if h > 1.6 * w else full
    return [full, label]


def _pad(box, w, h, px: float, py: float):
    x0, y0, x1, y1 = box
    bw, bh = x1 - x0, y1 - y0
    return (max(0, int(x0 - bw * px)), max(0, int(y0 - bh * py)), min(w, int(x1 + bw * px)), min(h, int(y1 + bh * py)))


QUERY_VIEWS = ("box", "box_label", "center", "full")


def query_views(img: Image.Image, box: tuple[int, int, int, int] | None) -> list[Image.Image]:
    """Кропы запроса. `box` — рамка бутылки от локатора, None — не нашли."""
    img = img.convert("RGB")
    w, h = img.size
    center = img.crop((int(w * 0.15), int(h * 0.05), int(w * 0.85), int(h * 0.95)))
    if box is None:
        box_img = center
        label_img = img.crop((int(w * 0.2), int(h * 0.25), int(w * 0.8), int(h * 0.9)))
    else:
        b = _pad(box, w, h, 0.08, 0.04)
        box_img = img.crop(b)
        bw, bh = b[2] - b[0], b[3] - b[1]
        # Нижняя часть рамки — этикетка, если рамка вытянута как бутылка целиком.
        label_img = img.crop((b[0], b[1] + int(bh * 0.38), b[2], b[3])) if bh > 1.6 * bw else box_img
    return [box_img, label_img, center, img]
