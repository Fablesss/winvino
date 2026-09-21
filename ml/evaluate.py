"""Метрики ретривала: top-k по референсам каталога."""
from __future__ import annotations

import numpy as np


def rank_of_truth(sims: np.ndarray, ref_names: list[str], truth: list[str | None]) -> list[int | None]:
    """Позиция (с 1) правильного референса в выдаче; None — эталона нет в каталоге."""
    order = np.argsort(-sims, axis=1)
    pos = {n: i for i, n in enumerate(ref_names)}
    ranks = []
    for row, t in zip(order, truth):
        if t is None or t not in pos:
            ranks.append(None)
            continue
        ranks.append(int(np.nonzero(row == pos[t])[0][0]) + 1)
    return ranks


def summarize(ranks: list[int | None]) -> dict:
    r = np.array([x for x in ranks if x is not None])
    if not len(r):
        return {"n": 0}
    return {
        "n": int(len(r)),
        "top1": round(float((r == 1).mean()), 4),
        "top5": round(float((r <= 5).mean()), 4),
        "top20": round(float((r <= 20).mean()), 4),
        "median_rank": float(np.median(r)),
    }
