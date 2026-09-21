"""Синтетические кадры «бутылка на полке» из студийных рендеров каталога.

Реальных фото с эталоном почти нет, а на инференсе приходит телефонный снимок полки:
соседние бутылки, блики на стекле, тёплый свет, наклон, ценник, крупный план этикетки.
Генератор собирает такой кадр из вырезанной бутылки и возвращает рамку цели.

Детерминирован по `rng`: один и тот же seed даёт один и тот же кадр, поэтому
eval-набор воспроизводим без хранения картинок.
"""
from __future__ import annotations

import hashlib
import io
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

from .common import ROOT, load_cached

UPLOADS_DIR = ROOT / "data" / "raw" / "strapi" / "prod-svoe-vino-strapi" / "prod-svoe-vino" / "strapi" / "uploads"
BG_EXT = {".webp", ".jpg", ".jpeg", ".png"}


@dataclass
class Scene:
    image: Image.Image
    box: tuple[int, int, int, int]  # рамка целевой бутылки в координатах кадра, может выходить за край


def background_pool(exclude: set[str], split: str, min_side: int = 400) -> list[Path]:
    """Фоны — фото из uploads, не являющиеся рендерами каталога (статьи, мероприятия, виноградники).

    Делятся детерминированно по хэшу имени: eval-фоны модель на обучении не видит.
    """
    out = []
    for p in sorted(UPLOADS_DIR.iterdir()):
        name = p.name
        if p.suffix.lower() not in BG_EXT or name in exclude:
            continue
        if name.startswith(("thumbnail_", "small_", "medium_", "large_")):
            continue
        bucket = int(hashlib.md5(name.encode()).hexdigest(), 16) % 10
        if (split == "eval") != (bucket == 0):
            continue
        out.append(p)
    # Размер проверяем лениво при загрузке: открывать 4 тыс. файлов на старте дорого.
    return out


def _random_background(rng: np.random.Generator, pool: list[Path], size: tuple[int, int]) -> Image.Image:
    w, h = size
    kind = rng.random()
    if pool and kind < 0.7:
        for _ in range(5):
            try:
                # 1024 — тот же кеш, что у майнинга реальных фото: он уже прогрет.
                bg = load_cached(pool[rng.integers(len(pool))], 1024).convert("RGB")
            except Exception:
                continue
            if min(bg.size) < 200:
                continue
            # Сначала вырезаем, потом масштабируем: ресайз всего фона — самая дорогая операция.
            scale = max(w / bg.width, h / bg.height) * rng.uniform(1.0, 1.6)
            cw, ch = min(bg.width, int(w / scale) + 1), min(bg.height, int(h / scale) + 1)
            x0 = rng.integers(0, bg.width - cw + 1)
            y0 = rng.integers(0, bg.height - ch + 1)
            bg = bg.crop((x0, y0, x0 + cw, y0 + ch)).resize((w, h), Image.BILINEAR)
            # Фон за бутылкой на полке почти всегда не в фокусе.
            return bg.filter(ImageFilter.GaussianBlur(rng.uniform(0, 3)))
    # Тёмная полка или стол: градиент с шумом.
    top = rng.integers(0, 120, 3)
    bottom = np.clip(top + rng.integers(-40, 80, 3), 0, 255)
    t = np.linspace(0, 1, h)[:, None, None]
    grad = (top[None, None, :] * (1 - t) + bottom[None, None, :] * t).repeat(w, axis=1)
    grad = grad + rng.normal(0, 6, grad.shape)
    return Image.fromarray(np.clip(grad, 0, 255).astype(np.uint8), "RGB")


def _cylinder_shade(bottle: Image.Image, rng: np.random.Generator) -> Image.Image:
    """Затемнение к краям и вертикальный блик — плоский рендер начинает выглядеть круглым стеклом."""
    arr = np.asarray(bottle).astype(np.float32)
    h, w = arr.shape[:2]
    x = np.linspace(-1, 1, w)
    shade = 1 - rng.uniform(0.1, 0.45) * np.abs(x) ** rng.uniform(1.5, 3)
    arr[..., :3] *= shade[None, :, None]
    if rng.random() < 0.7:
        cx = rng.uniform(-0.7, 0.7)
        width = rng.uniform(0.03, 0.15)
        glare = np.exp(-((x - cx) ** 2) / (2 * width ** 2)) * rng.uniform(40, 170)
        arr[..., :3] += glare[None, :, None]
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGBA")


def _perspective(img: Image.Image, rng: np.random.Generator, strength: float) -> Image.Image:
    w, h = img.size
    d = strength * min(w, h)
    src = np.float32([[0, 0], [w, 0], [w, h], [0, h]])
    dst = src + rng.uniform(-d, d, (4, 2)).astype(np.float32)
    dst -= dst.min(axis=0)
    out_w, out_h = int(dst[:, 0].max()) + 1, int(dst[:, 1].max()) + 1
    m = cv2.getPerspectiveTransform(src, dst)
    arr = cv2.warpPerspective(np.asarray(img), m, (out_w, out_h), flags=cv2.INTER_LINEAR,
                              borderMode=cv2.BORDER_CONSTANT, borderValue=(0, 0, 0, 0))
    return Image.fromarray(arr, "RGBA")


def _paste(canvas: Image.Image, bottle: Image.Image, x: int, y: int) -> None:
    canvas.paste(bottle, (x, y), bottle)


def _price_tag(canvas: Image.Image, rng: np.random.Generator) -> None:
    w, h = canvas.size
    tw, th = int(w * rng.uniform(0.15, 0.35)), int(h * rng.uniform(0.05, 0.1))
    x = int(rng.uniform(-0.1, 0.9) * w)
    y = int(rng.uniform(0.7, 0.95) * h)
    draw = ImageDraw.Draw(canvas)
    color = tuple(int(c) for c in rng.choice([[230, 40, 40], [250, 220, 40], [255, 255, 255], [240, 120, 30]]))
    draw.rectangle((x, y, x + tw, y + th), fill=color)
    for i in range(rng.integers(1, 4)):
        ly = y + int(th * (0.2 + 0.25 * i))
        draw.rectangle((x + 5, ly, x + int(tw * rng.uniform(0.3, 0.9)), ly + max(2, th // 8)), fill=(20, 20, 20))


def _shelf_bar(canvas: Image.Image, rng: np.random.Generator) -> None:
    w, h = canvas.size
    y = int(rng.uniform(0.75, 0.98) * h)
    bh = int(h * rng.uniform(0.01, 0.03))
    g = int(rng.integers(90, 200))
    ImageDraw.Draw(canvas).rectangle((0, y, w, y + bh), fill=(g, g, g))


def _photometric(img: Image.Image, rng: np.random.Generator) -> Image.Image:
    arr = np.asarray(img)
    # Баланс белого, контраст, яркость и гамма сворачиваются в одну таблицу на канал:
    # поканальный LUT по uint8 на порядок быстрее той же арифметики во float32.
    gains = rng.uniform(0.85, 1.15, 3)
    contrast, bright, gamma = rng.uniform(0.7, 1.25), rng.uniform(0.7, 1.25), rng.uniform(0.75, 1.35)
    x = np.arange(256, dtype=np.float32)
    luts = []
    for g in gains:
        v = np.clip((x * g - 128) * contrast + 128 * bright, 0, 255)
        luts.append(np.clip(255 * (v / 255) ** gamma, 0, 255).astype(np.uint8))
    arr = np.dstack([cv2.LUT(np.ascontiguousarray(arr[..., c]), luts[c]) for c in range(3)])
    s = rng.uniform(0.6, 1.3)                                   # насыщенность
    gray3 = cv2.cvtColor(cv2.cvtColor(arr, cv2.COLOR_RGB2GRAY), cv2.COLOR_GRAY2RGB)
    arr = cv2.addWeighted(arr, s, gray3, 1 - s, 0)
    if rng.random() < 0.6:
        noise = rng.normal(0, rng.uniform(1, 8), arr.shape).astype(np.int16)
        arr = np.clip(arr.astype(np.int16) + noise, 0, 255).astype(np.uint8)
    out = Image.fromarray(arr, "RGB")
    r = rng.random()
    if r < 0.3:
        out = out.filter(ImageFilter.GaussianBlur(rng.uniform(0.5, 2.0)))
    elif r < 0.45:
        k = int(rng.integers(3, 9))
        kernel = np.zeros((k, k), np.float32)
        kernel[k // 2, :] = 1 / k
        m = cv2.getRotationMatrix2D((k / 2, k / 2), rng.uniform(0, 180), 1)
        kernel = cv2.warpAffine(kernel, m, (k, k))
        kernel /= max(kernel.sum(), 1e-6)
        out = Image.fromarray(cv2.filter2D(np.asarray(out), -1, kernel))
    if rng.random() < 0.5:
        s = rng.uniform(0.35, 0.8)
        small = out.resize((max(16, int(out.width * s)), max(16, int(out.height * s))), Image.BILINEAR)
        out = small.resize(out.size, Image.BILINEAR)
    buf = io.BytesIO()
    out.save(buf, "JPEG", quality=int(rng.integers(35, 95)))
    buf.seek(0)
    return Image.open(buf).convert("RGB")


def make_scene(
    target: Image.Image,
    neighbors: list[Image.Image],
    rng: np.random.Generator,
    bg_pool: list[Path],
    size: tuple[int, int] = (480, 640),
) -> Scene:
    """Кадр 3:4 с целевой бутылкой в центре.

    480×640 хватает с запасом: энкодер видит кропы, вписанные в 256×256. Больший кадр
    только умножает работу CPU, который и так узкое место обучения.

    `target` и `neighbors` — вырезанные бутылки (`common.cutout`). Два режима:
    общий план полки (бутылка целиком, соседи по бокам) и крупный план, где этикетка
    заполняет кадр, а горлышко и дно обрезаны — как на контрольном фото с Donum.
    """
    w, h = size
    canvas = _random_background(rng, bg_pool, size).convert("RGBA")

    close_up = rng.random() < 0.4
    bottle_h = h * (rng.uniform(1.15, 2.1) if close_up else rng.uniform(0.55, 0.98))
    scale = bottle_h / target.height
    # Реальные бутылки уже рендеров с полями: не даём цели стать шире кадра.
    scale = min(scale, w * rng.uniform(0.55, 1.1) / target.width)
    tw, th = max(8, round(target.width * scale)), max(8, round(target.height * scale))

    cx = w / 2 + rng.normal(0, 0.06 * w)
    if close_up:
        # Этикетка обычно на 45–85% высоты бутылки — держим её в центре кадра.
        label_y = rng.uniform(0.5, 0.75) * th
        y0 = int(h / 2 + rng.normal(0, 0.05 * h) - label_y)
    else:
        # Общий план: бутылка целиком в кадре, стоит где-то между верхом и низом.
        margin = 0.02 * h
        y0 = int(rng.uniform(margin, h - th - margin)) if th < h - 2 * margin else int((h - th) / 2)
    x0 = int(cx - tw / 2)

    # Соседи — позади цели, того же масштаба, стоят на той же полке.
    for side in (-1, 1):
        if not neighbors or rng.random() > 0.75:
            continue
        nb = neighbors[int(rng.integers(len(neighbors)))]
        ns = scale * rng.uniform(0.85, 1.1) * (target.height / nb.height if rng.random() < 0.8 else 1)
        nw, nh = max(8, round(nb.width * ns)), max(8, round(nb.height * ns))
        gap = tw * rng.uniform(0.0, 0.25)
        nx = int(x0 - nw - gap) if side < 0 else int(x0 + tw + gap)
        ny = y0 + th - nh
        nbi = _cylinder_shade(nb.resize((nw, nh), Image.BICUBIC), rng)
        _paste(canvas, nbi, nx, ny)

    bottle = _cylinder_shade(target.resize((tw, th), Image.BICUBIC), rng)
    if rng.random() < 0.7:
        bottle = _perspective(bottle, rng, rng.uniform(0.01, 0.06))
    angle = rng.normal(0, 3)
    bottle = bottle.rotate(angle, resample=Image.BICUBIC, expand=True)
    x0 -= (bottle.width - tw) // 2
    y0 -= (bottle.height - th) // 2
    _paste(canvas, bottle, x0, y0)

    scene = canvas.convert("RGB")
    if rng.random() < 0.35:
        _shelf_bar(scene, rng)
    if rng.random() < 0.35:
        _price_tag(scene, rng)
    scene = _photometric(scene, rng)
    return Scene(image=scene, box=(x0, y0, x0 + bottle.width, y0 + bottle.height))


def crop_box(scene: Scene, rng: np.random.Generator | None, pad: float = 0.08) -> Image.Image:
    """Кроп вокруг цели, как его отдал бы детектор: с полями и дрожанием границ."""
    w, h = scene.image.size
    x0, y0, x1, y1 = scene.box
    bw, bh = x1 - x0, y1 - y0
    jitter = (lambda s: rng.uniform(-s, s)) if rng is not None else (lambda s: 0.0)
    x0 -= bw * (pad + jitter(0.06))
    x1 += bw * (pad + jitter(0.06))
    y0 -= bh * (pad / 2 + jitter(0.04))
    y1 += bh * (pad / 2 + jitter(0.04))
    box = (max(0, int(x0)), max(0, int(y0)), min(w, int(x1)), min(h, int(y1)))
    if box[2] - box[0] < 16 or box[3] - box[1] < 16:
        return scene.image
    return scene.image.crop(box)
