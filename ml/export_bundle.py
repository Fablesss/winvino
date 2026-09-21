"""Бандл артефактов для деплоя: всё, что нужно сервису распознавания, кроме кода.

    .venv-ml\\Scripts\\python.exe -m ml.export_bundle

Внутри — та же раскладка, что у WINVINO_DATA_DIR, поэтому распакованный бандл и есть
корень данных контейнера:

    dataset/catalog.jsonl                 каталог (слаги, названия) — для OCR-матчера
    model/recognizer.json                 чекпойнт + веса слияния
    model/checkpoints/<чекпойнт>.pt       визуальная башня SigLIP2 целиком (HF не нужен)
    model/index/<тег>-<ключ>.npz          эмбеддинги 2096 референсов (картинки не нужны)
    bundle.json                           тег модели, дата, sha256 каждого файла

Рядом кладётся <архив>.sha256 — его значение идёт в ARTIFACTS_SHA256 при деплое.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import tarfile
import time
from pathlib import Path

import torch

from .common import DATA_DIR, load_catalog
from .retrieval import index_cache_path


def sha256_of(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(DATA_DIR / "deploy"))
    args = ap.parse_args()

    cfg_path = DATA_DIR / "model" / "recognizer.json"
    cfg = json.loads(cfg_path.read_text(encoding="utf-8"))
    ckpt = DATA_DIR / cfg["checkpoint"]
    state = torch.load(ckpt, map_location="cpu", mmap=True)
    tag = f"{state['model']}-{state['tag']}"
    catalog = load_catalog()
    index = index_cache_path(catalog, tag)
    if not index.exists():
        raise SystemExit(f"нет индекса {index}: сначала поднимите ml.worker с этим чекпойнтом, он его построит")

    files = [DATA_DIR / "dataset" / "catalog.jsonl", cfg_path, ckpt, index]
    manifest = {
        "tag": tag,
        "created": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "files": {f.relative_to(DATA_DIR).as_posix(): sha256_of(f) for f in files},
    }
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    archive = out_dir / f"winvino-recognizer-{tag}.tar.gz"
    manifest_path = out_dir / "bundle.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")
    with tarfile.open(archive, "w:gz", compresslevel=6) as tar:
        for f in files:
            tar.add(f, arcname=f.relative_to(DATA_DIR).as_posix())
        tar.add(manifest_path, arcname="bundle.json")
    digest = sha256_of(archive)
    (out_dir / f"{archive.name}.sha256").write_text(f"{digest}  {archive.name}\n", encoding="utf-8")
    print(json.dumps({"archive": str(archive), "mb": round(archive.stat().st_size / 2**20, 1), "sha256": digest, "tag": tag}, ensure_ascii=False, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
