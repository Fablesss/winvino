"""Визуальный индекс каталога: эмбеддинги видов каждого референса + поиск по запросу."""
from __future__ import annotations

import hashlib
from dataclasses import dataclass

import numpy as np

from .backbones import Encoder
from .common import MODEL_DIR, CatalogItem, cutout, load_cached
from .views import REF_VIEWS, ref_views


@dataclass
class VisualIndex:
    ref_names: list[str]               # уникальные файлы-референсы
    slugs: list[list[str]]             # слаги на каждый референс (7 фото делят по два слага)
    emb: np.ndarray                    # [n_refs, n_views, d]

    def scores(self, q: np.ndarray, weights: np.ndarray | None = None) -> np.ndarray:
        """q: [n_qviews, d] → [n_refs] — максимум сходства по парам видов.

        `weights` [n_qviews] — поправка к виду запроса (весь кадр менее надёжен, чем
        рамка бутылки): сходство вида умножается на вес перед максимумом.
        """
        s = np.einsum("qd,rvd->rqv", q, self.emb)  # [refs, qviews, rviews]
        if weights is not None:
            s = s * weights[None, :, None]
        return s.reshape(len(self.ref_names), -1).max(axis=1)


def build_index(encoder: Encoder, catalog: list[CatalogItem], tag: str) -> VisualIndex:
    """Эмбеддинги референсов с кешем на диске: ключ — тег модели и список файлов."""
    by_image: dict[str, list[str]] = {}
    item_by_image: dict[str, CatalogItem] = {}
    for c in catalog:
        by_image.setdefault(c.image.name, []).append(c.slug)
        item_by_image.setdefault(c.image.name, c)
    names = sorted(by_image)
    key = hashlib.md5(("\n".join(names) + "|" + ",".join(REF_VIEWS)).encode()).hexdigest()[:10]
    cache = MODEL_DIR / "index" / f"{tag}-{key}.npz"
    if cache.exists():
        emb = np.load(cache)["emb"]
    else:
        views = [ref_views(cutout(load_cached(item_by_image[n].image))) for n in names]
        flat = [v for vs in views for v in vs]
        emb = encoder.embed(flat).reshape(len(names), len(REF_VIEWS), -1)
        cache.parent.mkdir(parents=True, exist_ok=True)
        np.savez(cache, emb=emb)
    return VisualIndex(ref_names=names, slugs=[by_image[n] for n in names], emb=emb)
