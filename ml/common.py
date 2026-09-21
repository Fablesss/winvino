"""Общее для ML-конвейера: пути, каталог из манифеста, загрузка картинок.

Манифест собирает Node (`scripts/build-dataset-manifest.mjs`): там доступ к базе и
воспроизведение strapi-имён файлов. Python только читает готовый JSONL.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parent.parent
DATASET_DIR = ROOT / "data" / "raw" / "dataset"
MODEL_DIR = ROOT / "data" / "raw" / "model"
CATALOG_PATH = DATASET_DIR / "catalog.jsonl"

# Нейтральная заливка полей при letterbox: среднее ImageNet, не смещает ни один класс.
PAD_FILL = (124, 116, 104)


@dataclass(frozen=True)
class CatalogItem:
    slug: str
    title: str
    winery: str
    category: str
    image: Path
    shared_image: bool


def load_catalog(path: Path = CATALOG_PATH) -> list[CatalogItem]:
    items = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        r = json.loads(line)
        if not r.get("image"):
            continue
        items.append(CatalogItem(
            slug=r["slug"], title=r["title"], winery=r["winery"], category=r["category"],
            image=ROOT / r["image"], shared_image=bool(r.get("shared_image")),
        ))
    return items


def load_rgba(path: Path | str) -> Image.Image:
    """RGBA с учётом EXIF-поворота: фото с телефона без этого лежат на боку."""
    with Image.open(path) as im:
        im = ImageOps.exif_transpose(im)
        return im.convert("RGBA")


def load_rgb(path: Path | str) -> Image.Image:
    with Image.open(path) as im:
        return ImageOps.exif_transpose(im).convert("RGB")


CACHE_DIR = ROOT / "data" / "raw" / "cache"


def load_cached(path: Path, max_side: int = 1024) -> Image.Image:
    """RGBA, уменьшенный до `max_side` и закешированный в PNG.

    Среди оригиналов есть jpg на 46 МБ; синтетика и обучение читают каждый файл
    тысячи раз, декодировать исходник каждый раз — минуты на пустом месте.
    """
    cache = CACHE_DIR / str(max_side) / (path.name + ".png")
    if cache.exists():
        with Image.open(cache) as im:
            return im.convert("RGBA")
    bigger = CACHE_DIR / "1024" / (path.name + ".png")
    if max_side < 1024 and bigger.exists():
        with Image.open(bigger) as im:
            img = im.convert("RGBA")  # уменьшенная копия из кеша, а не из многомегабайтного оригинала
    else:
        img = load_rgba(path)
    if max(img.size) > max_side:
        img.thumbnail((max_side, max_side), Image.LANCZOS)
    cache.parent.mkdir(parents=True, exist_ok=True)
    img.save(cache, compress_level=1)
    return img


def flatten(img: Image.Image, bg: tuple[int, int, int] = (255, 255, 255)) -> Image.Image:
    """Альфа → сплошной фон. Прозрачное без этого становится чёрным."""
    if img.mode != "RGBA":
        return img.convert("RGB")
    base = Image.new("RGBA", img.size, bg + (255,))
    return Image.alpha_composite(base, img).convert("RGB")


def cutout(img: Image.Image) -> Image.Image:
    """Бутылка с прозрачным фоном, обрезанная по содержимому.

    У 1942 из 2096 рендеров альфа уже есть. У остальных фон чаще белый — его снимаем
    заливкой от краёв по почти-белому, чтобы не выгрызть белую этикетку в середине.
    Если фон не белый (реальное фото), возвращаем кадр целиком непрозрачным.
    """
    arr = np.asarray(img.convert("RGBA")).copy()
    alpha = arr[..., 3]
    if alpha.min() >= 250:
        rgb = arr[..., :3]
        near_white = rgb.min(axis=2) > 235
        border = np.concatenate([near_white[0], near_white[-1], near_white[:, 0], near_white[:, -1]])
        if border.mean() > 0.9:
            import cv2

            mask = near_white.astype(np.uint8)
            h, w = mask.shape
            flood = np.zeros((h + 2, w + 2), np.uint8)
            fill = mask.copy()
            for x, y in ((0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)):
                if fill[y, x] == 1:
                    cv2.floodFill(fill, flood, (x, y), 2)
            background = fill == 2
            alpha = np.where(background, 0, 255).astype(np.uint8)
            alpha = cv2.GaussianBlur(alpha, (3, 3), 0)
            arr[..., 3] = alpha
    ys, xs = np.nonzero(arr[..., 3] > 16)
    if len(xs) == 0:
        return Image.fromarray(arr, "RGBA")
    return Image.fromarray(arr[ys.min(): ys.max() + 1, xs.min(): xs.max() + 1], "RGBA")


def letterbox(img: Image.Image, size: int, fill: tuple[int, int, int] = PAD_FILL) -> Image.Image:
    """Вписывает в квадрат без искажения пропорций, поля заливает `fill`."""
    img = img.convert("RGB")
    scale = size / max(img.size)
    w, h = max(1, round(img.width * scale)), max(1, round(img.height * scale))
    canvas = Image.new("RGB", (size, size), fill)
    canvas.paste(img.resize((w, h), Image.BICUBIC), ((size - w) // 2, (size - h) // 2))
    return canvas
