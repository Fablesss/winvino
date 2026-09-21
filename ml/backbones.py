"""Энкодеры изображений: единый интерфейс поверх timm (DINOv2) и open_clip (CLIP, SigLIP2).

На выходе — L2-нормированный вектор, сходство = скалярное произведение.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import torch
import torch.nn.functional as F
from PIL import Image

from .common import letterbox


IMAGENET = ((0.485, 0.456, 0.406), (0.229, 0.224, 0.225))
OPENAI_CLIP = ((0.48145466, 0.4578275, 0.40821073), (0.26862954, 0.26130258, 0.27577711))
SIGLIP = ((0.5, 0.5, 0.5), (0.5, 0.5, 0.5))


@dataclass(frozen=True)
class Spec:
    lib: str        # "timm" | "open_clip"
    name: str
    pretrained: str
    size: int
    # Нормализация зафиксирована здесь, а не берётся из библиотеки: без предобученных весов
    # open_clip подставляет среднее OpenAI CLIP даже для SigLIP (обучен с 0.5/0.5), и
    # эмбеддинги молча разъезжаются с индексом.
    norm: tuple[tuple[float, float, float], tuple[float, float, float]]


SPECS: dict[str, Spec] = {
    "dinov2-s": Spec("timm", "vit_small_patch14_dinov2.lvd142m", "", 224, IMAGENET),
    "dinov2-b": Spec("timm", "vit_base_patch14_dinov2.lvd142m", "", 224, IMAGENET),
    "clip-b16": Spec("open_clip", "ViT-B-16", "laion2b_s34b_b88k", 224, OPENAI_CLIP),
    "siglip2-b16": Spec("open_clip", "ViT-B-16-SigLIP2-256", "webli", 256, SIGLIP),
    "siglip2-b16-384": Spec("open_clip", "ViT-B-16-SigLIP2-384", "webli", 384, SIGLIP),
}


class Encoder(torch.nn.Module):
    """Визуальная башня + препроцессинг. `size` можно переопределить (DINOv2 тянет любой кратный 14).

    `pretrained=False` — только архитектура, без скачивания весов: так грузится сервис, у
    которого все веса визуальной башни лежат в дообученном чекпойнте.
    """

    def __init__(self, key: str, size: int | None = None, pretrained: bool = True):
        super().__init__()
        spec = SPECS[key]
        self.key = key
        self.size = size or spec.size
        if spec.lib == "timm":
            import timm

            self.net = timm.create_model(spec.name, pretrained=pretrained, num_classes=0, img_size=self.size)
        else:
            import open_clip

            model, _, _ = open_clip.create_model_and_transforms(spec.name, pretrained=spec.pretrained if pretrained else None)
            self.net = model.visual  # текстовая башня не нужна — не держим её в 4 ГБ видеопамяти
        mean, std = spec.norm
        self.register_buffer("mean", torch.tensor(mean).view(1, 3, 1, 1), persistent=False)
        self.register_buffer("std", torch.tensor(std).view(1, 3, 1, 1), persistent=False)

    def to_tensor(self, img: Image.Image) -> torch.Tensor:
        """PIL → тензор 3×S×S в [0, 1], letterbox без искажения пропорций."""
        arr = np.asarray(letterbox(img, self.size), dtype=np.float32) / 255.0
        return torch.from_numpy(arr).permute(2, 0, 1)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        x = (x - self.mean) / self.std
        return F.normalize(self.net(x).float(), dim=-1)

    @torch.no_grad()
    def embed(self, images: list[Image.Image], batch: int = 32) -> np.ndarray:
        device = self.mean.device
        # fp16 выгоден только с тензорными ядрами (Volta+); на Pascal он в разы медленнее fp32.
        half = device.type == "cuda" and torch.cuda.get_device_capability(device)[0] >= 7
        out = []
        for i in range(0, len(images), batch):
            x = torch.stack([self.to_tensor(im) for im in images[i: i + batch]]).to(device)
            with torch.autocast(device.type, enabled=half):
                out.append(self(x).cpu().numpy())
        return np.concatenate(out) if out else np.zeros((0, 1), np.float32)
