#!/bin/sh
# Артефакты модели уже лежат в $WINVINO_DATA_DIR: они запекаются в образ из artifacts/ репозитория
# (deploy/recognizer.Dockerfile). ARTIFACTS_URL — необязательная замена: скачать другой бандл,
# сверить, распаковать поверх. Затем — сервис распознавания.
#
#   ARTIFACTS_URL     адрес архива (ml/export_bundle.py). Для приватного релиза GitHub —
#                     API-адрес ассета: https://api.github.com/repos/<owner>/<repo>/releases/assets/<id>
#   ARTIFACTS_SHA256  sha256 архива (файл .sha256 рядом с ним) — обязателен вместе с URL
#   ARTIFACTS_TOKEN   токен с правом чтения репозитория, если релиз приватный
#
# Загруженный бандл живёт в слое контейнера, а не в томе: без тома каждый рестарт качает заново.
set -eu

DATA="${WINVINO_DATA_DIR:-/data}"
MARK="$DATA/.bundle.sha256"
mkdir -p "$DATA"

if [ -n "${ARTIFACTS_URL:-}" ]; then
  : "${ARTIFACTS_SHA256:?ARTIFACTS_SHA256 обязателен вместе с ARTIFACTS_URL}"
  if [ "$(cat "$MARK" 2>/dev/null || true)" = "$ARTIFACTS_SHA256" ]; then
    echo "артефакты: бандл $ARTIFACTS_SHA256 уже на месте"
  else
    echo "артефакты: качаю бандл $ARTIFACTS_SHA256"
    TMP="$DATA/.bundle.download"
    if [ -n "${ARTIFACTS_TOKEN:-}" ]; then
      # GitHub отвечает редиректом на подписанный адрес хранилища; curl не передаёт
      # Authorization на другой хост при редиректе, токен не утекает.
      curl -fSL --retry 3 --retry-delay 5 -H "Authorization: Bearer $ARTIFACTS_TOKEN" \
        -H "Accept: application/octet-stream" -o "$TMP" "$ARTIFACTS_URL"
    else
      curl -fSL --retry 3 --retry-delay 5 -o "$TMP" "$ARTIFACTS_URL"
    fi
    echo "$ARTIFACTS_SHA256  $TMP" | sha256sum -c -
    rm -rf "$DATA/dataset" "$DATA/model" "$DATA/bundle.json" "$DATA/bundle.sha256sums"
    tar -xzf "$TMP" -C "$DATA"
    rm -f "$TMP"
    echo "$ARTIFACTS_SHA256" > "$MARK"
    echo "артефакты: распакованы в $DATA"
  fi
fi

if [ ! -f "$DATA/model/recognizer.json" ]; then
  echo "нет артефактов модели в $DATA: соберите образ с artifacts/ из репозитория (npm run bundle:repo)" >&2
  echo "или задайте ARTIFACTS_URL и ARTIFACTS_SHA256, или положите распакованный бандл сами" >&2
  exit 1
fi

cd /app
exec node scripts/serve-recognizer.mjs
