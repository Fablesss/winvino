"""Где в кадре целевая бутылка: детектор COCO (класс bottle) + выбор самой «центральной».

На полке в кадре несколько бутылок, снимающий держит нужную в центре и крупно.
Счёт кандидата = уверенность × близость к центру × доля площади. Если детектор ничего
не нашёл (крупный план, где бутылка не похожа на бутылку, а видна одна этикетка),
возвращаем центральную область кадра.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import torch
from PIL import Image

BOTTLE = 44  # индекс класса в torchvision COCO (91 категория с пропусками)
DETECT_SIDE = 640
# Рамка, чей центр дальше этой доли ширины от середины кадра, — соседняя бутылка, а не
# цель. Детектор COCO не находит цель в ~25% синтетических кадров (крупный план, тёмное
# стекло), и тогда лучшей «центральной» становится сосед: 12.8% кадров. С отсевом таких
# рамок top-1 на синтетике 83.3% → 88.2% при потолке 90.0% с идеальной рамкой.
MAX_OFFCENTER = 0.2


@dataclass
class Located:
    box: tuple[int, int, int, int]
    score: float
    source: str  # "detector" | "fallback"


class BottleLocator:
    def __init__(self, device: torch.device, min_score: float = 0.25):
        from torchvision.models.detection import (
            FasterRCNN_MobileNet_V3_Large_FPN_Weights,
            fasterrcnn_mobilenet_v3_large_fpn,
        )

        self.model = fasterrcnn_mobilenet_v3_large_fpn(
            weights=FasterRCNN_MobileNet_V3_Large_FPN_Weights.COCO_V1, box_score_thresh=min_score,
        ).to(device).eval()
        self.device = device

    @torch.no_grad()
    def bottles(self, img: Image.Image) -> list[tuple[tuple[int, int, int, int], float]]:
        scale = DETECT_SIDE / max(img.size)
        small = img.convert("RGB").resize((max(1, round(img.width * scale)), max(1, round(img.height * scale))))
        x = torch.from_numpy(np.asarray(small, dtype=np.float32) / 255).permute(2, 0, 1).to(self.device)
        out = self.model([x])[0]
        res = []
        for box, label, score in zip(out["boxes"].cpu().numpy(), out["labels"].cpu().numpy(), out["scores"].cpu().numpy()):
            if label != BOTTLE:
                continue
            x0, y0, x1, y1 = (box / scale).round().astype(int)
            res.append(((int(x0), int(y0), int(x1), int(y1)), float(score)))
        return res

    def target(self, img: Image.Image) -> Located:
        w, h = img.size
        best, best_val = None, 0.0
        for box, score in self.bottles(img):
            cx, cy = (box[0] + box[2]) / 2 / w, (box[1] + box[3]) / 2 / h
            if abs(cx - 0.5) > MAX_OFFCENTER:
                continue
            centrality = max(0.0, 1 - abs(cx - 0.5) * 2) ** 1.5 * max(0.2, 1 - abs(cy - 0.5))
            area = (box[2] - box[0]) * (box[3] - box[1]) / (w * h)
            val = score * centrality * area ** 0.5
            if val > best_val:
                best, best_val = (box, score), val
        if best is None:
            return Located(box=(int(w * 0.15), int(h * 0.05), int(w * 0.85), int(h * 0.95)), score=0.0, source="fallback")
        return Located(box=best[0], score=best[1], source="detector")
