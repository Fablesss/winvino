# Сервис распознавания: Node-оркестратор (scripts/serve-recognizer.mjs) + два Python-окружения —
# torch (визуал: детектор + SigLIP2) и PaddleOCR. Контекст сборки — корень репозитория.
#
# Артефакты модели (~340 МБ: чекпойнт, индекс, каталог) в образ НЕ входят: entrypoint качает
# бандл по ARTIFACTS_URL в том /data и сверяет sha256. Веса моделей-зависимостей (детектор
# torchvision, PaddleOCR) запекаются при сборке — в рантайме сервис в интернет не ходит.

FROM node:24-bookworm-slim AS node-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

FROM python:3.12-slim-bookworm
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# libgl1, libglib2.0-0 — OpenCV в окружении PaddleOCR; libgomp1 — OpenMP для paddle и torch;
# curl — загрузка бандла и healthcheck.
RUN apt-get update \
 && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 libgomp1 curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY --from=node-deps /usr/local/bin/node /usr/local/bin/node
WORKDIR /app

# Два окружения, как при разработке: torch и paddle тянут несовместимые numpy.
# Локальный lock снят с CUDA-сборки torch — на сервере ставится CPU-сборка той же версии.
COPY ml/requirements.lock.txt /tmp/req-ml.txt
RUN sed 's/+cu126/+cpu/' /tmp/req-ml.txt > /tmp/req-ml-cpu.txt \
 && python -m venv /opt/venv-ml \
 && /opt/venv-ml/bin/pip install -r /tmp/req-ml-cpu.txt --extra-index-url https://download.pytorch.org/whl/cpu
COPY ocr/requirements.lock.txt /tmp/req-ocr.txt
RUN python -m venv /opt/venv-ocr \
 && /opt/venv-ocr/bin/pip install -r /tmp/req-ocr.txt

RUN /opt/venv-ml/bin/python -c "from torchvision.models.detection import fasterrcnn_mobilenet_v3_large_fpn as m, FasterRCNN_MobileNet_V3_Large_FPN_Weights as w; m(weights=w.COCO_V1)"
COPY ocr/ ocr/
RUN cd ocr && /opt/venv-ocr/bin/python -c "import argparse; from paddle_ocr import build_ocr; build_ocr(argparse.Namespace(det='mobile', rec='eslav_PP-OCRv5_mobile_rec', no_mkldnn=False, threads=2))"

COPY --from=node-deps /app/node_modules node_modules
COPY package.json ./
COPY ml/ ml/
COPY scripts/serve-recognizer.mjs scripts/
COPY scripts/lib/ scripts/lib/
COPY deploy/recognizer-entrypoint.sh /usr/local/bin/recognizer-entrypoint
# CRLF из Windows-чекаута сломал бы shebang — снимаем на всякий случай.
RUN sed -i 's/\r$//' /usr/local/bin/recognizer-entrypoint && chmod +x /usr/local/bin/recognizer-entrypoint

ENV WINVINO_DATA_DIR=/data \
    ML_PYTHON=/opt/venv-ml/bin/python \
    OCR_PYTHON=/opt/venv-ocr/bin/python \
    HF_HUB_OFFLINE=1 \
    HOST=0.0.0.0 \
    PORT=8080
VOLUME /data
EXPOSE 8080
# Первый старт включает загрузку бандла и подъём моделей на CPU — отсюда длинный start-period.
HEALTHCHECK --interval=20s --timeout=5s --start-period=900s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${PORT}/health" > /dev/null || exit 1
ENTRYPOINT ["recognizer-entrypoint"]
