"""Фиксированные наборы запросов для оценки ретривала.

synthetic — кадры из `synth.make_scene` на eval-фонах (на обучении не встречаются),
             сохраняются на диск один раз, чтобы все модели мерились на одних и тех же;
real       — настоящие фото с эталоном из `data/raw/dataset/real/queries.jsonl`.
             `slug: null` — вина нет в каталоге, правильного ответа не существует.

Кадры из `data/eval-exclusions.jsonl` в метрики не идут (`drop_excluded`): ошибка на них —
от данных (картинка слага неотличима от чужой, дубль слага), а не от распознавания.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from .common import DATASET_DIR, ROOT, CatalogItem, cutout, load_cached
from .synth import Scene, background_pool, crop_box, make_scene

SYNTH_DIR = DATASET_DIR / "synthetic-eval"
REAL_DIR = DATASET_DIR / "real"
EXCLUSIONS_PATH = ROOT / "data" / "eval-exclusions.jsonl"


@dataclass
class Query:
    file: Path
    target_image: str | None   # имя файла-референса; None — вина нет в каталоге
    slug: str | None
    box: tuple[int, int, int, int] | None = None


def ref_width(item: CatalogItem) -> int:
    from PIL import Image

    with Image.open(item.image) as im:
        return im.width


def build_synthetic(catalog: list[CatalogItem], n: int, seed: int, out_dir: Path = SYNTH_DIR,
                    size: tuple[int, int] = (480, 640), min_ref_width: int = 0) -> list[Query]:
    """Генерирует n кадров, по одному на случайный уникальный референс. Идемпотентно.

    `size` и `min_ref_width` нужны, чтобы собрать набор, на котором текст этикетки вообще
    читается. В базовом наборе (кадр 480×640, рендеры от 116 px) он нечитаем по построению:
    OCR видит год лишь на 22.5% кадров. На таких данных веса слияния систематически занижают
    текст, а в проде приходит фото 3024×4032, где этикетка читается. Набор из крупных рендеров
    в большом кадре — ближайшее к проду, что можно собрать, не имея реальных фото.
    """
    manifest = out_dir / f"queries-{seed}-{n}.jsonl"
    if manifest.exists():
        return load_queries(manifest)
    out_dir.mkdir(parents=True, exist_ok=True)
    by_image: dict[str, CatalogItem] = {}
    for c in catalog:
        by_image.setdefault(c.image.name, c)
    images = sorted(by_image)
    if min_ref_width:
        images = [name for name in images if ref_width(by_image[name]) >= min_ref_width]
        print(f"  референсов не уже {min_ref_width} px: {len(images)} из {len(by_image)}")
    rng = np.random.default_rng(seed)
    pool = background_pool({c.image.name for c in catalog}, "eval")
    picks = rng.choice(len(images), size=min(n, len(images)), replace=False)
    rows = []
    for i, k in enumerate(picks):
        item = by_image[images[k]]
        target = cutout(load_cached(item.image))
        neighbors = [cutout(load_cached(by_image[images[j]].image)) for j in rng.integers(0, len(images), 3)]
        scene: Scene = make_scene(target, neighbors, rng, pool, size)
        name = f"q{seed}_{i:05d}.jpg"
        scene.image.save(out_dir / name, quality=92)
        rows.append({"file": name, "target_image": item.image.name, "slug": item.slug, "box": list(scene.box)})
        if (i + 1) % 200 == 0:
            print(f"  синтетика: {i + 1}/{len(picks)}")
    manifest.write_text("\n".join(json.dumps(r, ensure_ascii=False) for r in rows) + "\n", encoding="utf-8")
    return load_queries(manifest)


def load_queries(manifest: Path) -> list[Query]:
    out = []
    for line in manifest.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        r = json.loads(line)
        out.append(Query(
            file=manifest.parent / r["file"], target_image=r.get("target_image"), slug=r.get("slug"),
            box=tuple(r["box"]) if r.get("box") else None,
        ))
    return out


def drop_excluded(queries: list[Query]) -> list[Query]:
    """Без кадров из `data/eval-exclusions.jsonl` (ключ — «папка набора/файл»).

    Применять после среза по позиции: номер кадра синтетики задаёт роль — 0:300 отбор
    чекпойнта, 300:700 обучение слияния, — и выкидывание до среза сдвинуло бы границы.
    """
    lines = EXCLUSIONS_PATH.read_text(encoding="utf-8").splitlines()
    keys = {json.loads(line)["file"] for line in lines if line.strip()}
    return [q for q in queries if f"{q.file.parent.name}/{q.file.name}" not in keys]


def real_upload_names() -> set[str]:
    """Файлы uploads, ставшие реальными тест-кадрами: их нельзя брать фонами для обучения."""
    manifest = REAL_DIR / "queries.jsonl"
    if not manifest.exists():
        return set()
    names = set()
    for line in manifest.read_text(encoding="utf-8").splitlines():
        if line.strip():
            src = json.loads(line).get("source_upload")
            if src:
                names.add(src)
    return names


def oracle_crop(q: Query, index: int):
    """Кроп по известной рамке с дрожанием — верхняя оценка при идеальном детекторе."""
    from PIL import Image

    img = Image.open(q.file).convert("RGB")
    return crop_box(Scene(image=img, box=q.box), np.random.default_rng(index))


def main() -> int:
    """Сборка набора отдельной командой: генерация идемпотентна, прогон моделей — нет.

        .venv-ml\\Scripts\\python.exe -m ml.evalset --out synthetic-hires --seed 2 \\
            --n 600 --size 1080x1440 --min-ref-width 800
    """
    import argparse

    from .common import load_catalog

    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=1000)
    ap.add_argument("--seed", type=int, default=1, help="он же префикс имён кадров: разные наборы не путаются")
    ap.add_argument("--out", default="synthetic-eval", help="папка внутри data/raw/dataset")
    ap.add_argument("--size", default="480x640", help="размер кадра ШxВ")
    ap.add_argument("--min-ref-width", type=int, default=0, help="брать только вина с рендером не уже этого")
    args = ap.parse_args()

    w, h = (int(v) for v in args.size.lower().split("x"))
    out_dir = DATASET_DIR / args.out
    queries = build_synthetic(load_catalog(), args.n, args.seed, out_dir, (w, h), args.min_ref_width)
    print(f"кадров {len(queries)} → {out_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
