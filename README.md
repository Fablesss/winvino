# winvino — сканер этикеток российского вина

Фото бутылки → карточка вина из каталога [«Своё вино»](https://vino-svoe.ru). Распознавание
визуальное (дообученная SigLIP2 ViT-B/16 по 2096 референсам каталога), текст с этикетки
(PaddleOCR) разводит визуальные ничьи — вина одной серии с одинаковым дизайном.

Клиентов три, API одно: веб (Telegram Mini App и PWA), Telegram-бот и контракт скрипта
оценки организатора.

Устройство пайплайна и границы слоёв — [ARCHITECTURE.md](ARCHITECTURE.md).

## Результаты

| | |
|---|---|
| Синтетический eval-набор, top-1 / top-5 | **91.9% / 99.0%** |
| Реальные фото, вино в каталоге (10 кадров) | 9/10 |
| Время ответа, кадр 1600 px — столько шлёт клиент | **0.96 с** медиана, p95 1.60 с, max 1.71 с |
| Время ответа, оригинал с телефона 3024×4032 | 2.5–3.6 с |
| Калибровка уверенности (ECE, синтетика) | 0.05 |
| Модель | `siglip2-b16-ft1-e4`, чекпойнт и индекс лежат в `artifacts/` |

Скорость мерялась 29.09.2026 на GTX 1050 Ti, 14 реальных кадров × 3 прохода. Визуальная часть
идёт на GPU и стоит 0.32 с; остальное — OCR, он работает на CPU. Целевые 3 секунды выдержаны на
всех 42 замерах на кадре 1600 px.

## Что нужно на машине

| | |
|---|---|
| Node | ≥ 24 — API и контракт исполняются из `.ts` без сборки (type stripping) |
| Python | 3.12, два отдельных окружения: torch и paddle тянут несовместимые numpy |
| Postgres | внешний, с каталогом вин. Расширения `pg_trgm`, `unaccent`, `fuzzystrmatch` |
| GPU | не обязателен: та же модель работает на CPU, медленнее |
| Docker | только для запуска всего стенда одной командой |

Модель качать не нужно: веса, индекс и каталог (~355 МБ) лежат в репозитории в `artifacts/`.
Чекпойнт разрезан на части по 90 МиБ — GitHub не принимает файлы больше 100 МиБ; склейка и
сверка sha256 происходят при сборке образа распознавателя.

## Запуск

### Вариант 1: Docker

```
cp .env.example .env            # вписать DATABASE_URL
docker network create dokploy-network
docker compose up --build
```

Первая сборка долгая (~10–20 мин): образ распознавателя тянет torch (CPU), PaddlePaddle, веса
детектора и OCR. В рантайме сервис в интернет не ходит.

Две оговорки:

- в `docker-compose.yml` у сервисов только `expose`, портов наружу нет — он написан под
  Dokploy, где домены назначает Traefik. Чтобы открыть веб с той же машины, добавьте
  `ports: ["3000:3000"]` сервису `web` (и `["8787:8787"]` для `api`, если нужно);
- **образы ни разу не собирались**: на машине разработки нет Docker. Что и как проверялось
  вместо этого — «Что проверено и что нет» в [docs/DEPLOY.md](docs/DEPLOY.md).

Деплой в Dokploy — [docs/DEPLOY.md](docs/DEPLOY.md).

### Вариант 2: без Docker, по частям

Так велась разработка, этот путь проверен.

```
# 1. Python-окружения (Windows; на Linux/macOS замените py -3.12 и пути к venv)
npm install
npm run ml:setup                 # .venv-ml: torch + timm + open_clip, ≈3 ГБ
npm run ocr:paddle:setup         # .venv-ocr: PaddleOCR

# 2. База: схема и каталог
cp .env.example .env             # DATABASE_URL, VINO_API_BASE
npm run db:migrate
npm run catalog:sync
npm run db:verify

# 3. Склеить чекпойнт из частей и сверить контрольные суммы
cat artifacts/model/checkpoints/ft1-best.pt.part* > artifacts/model/checkpoints/ft1-best.pt
(cd artifacts && sha256sum -c bundle.sha256sums)

# 4. Распознаватель — модель из artifacts/
WINVINO_DATA_DIR=artifacts npm run serve:recognizer     # http://127.0.0.1:8080

# 5. API и веб — отдельный npm-workspace, в соседних терминалах
cd platform && npm install
RECOGNIZER=model RECOGNIZER_URL=http://127.0.0.1:8080 DATABASE_URL=… npm run dev:api
npm run dev:web                  # http://localhost:3000, /api/* проксируется в API
```

Шаги 3–5 показаны в синтаксисе bash. В cmd переменные задаются отдельной строкой
(`set "WINVINO_DATA_DIR=artifacts"` — кавычки обязательны, иначе в значение попадёт пробел),
в PowerShell — через `$env:`; постоянные значения удобнее положить в `.env` рядом с пакетом,
`api` и `bot` подхватывают его сами. Склейка на Windows — `copy /b` из папки с частями:

```
copy /b ft1-best.pt.part00+ft1-best.pt.part01+ft1-best.pt.part02+ft1-best.pt.part03 ft1-best.pt
certutil -hashfile ft1-best.pt SHA256
```

Без этого шага распознаватель падает с `FileNotFoundError: …/ft1-best.pt`: в git чекпойнт лежит
частями по 90 МиБ, потому что GitHub не принимает файлы больше 100 МиБ. В образе распознавателя
склейку делает сборка (`deploy/recognizer.Dockerfile`, стадия `artifacts`), вручную это нужно
только при запуске без Docker.

Веб без базы и без модели тоже поднимается: `RECOGNIZER=mock` (значение по умолчанию) —
детерминированная заглушка по sha256 фото, 10 реальных вин из каталога. Этого хватает,
чтобы работать над интерфейсом.

Telegram-бот: `platform/bot/.env` с `TELEGRAM_BOT_TOKEN`, затем `npm run dev:bot`.
Один токен — один процесс, второй `getUpdates` получает 409 Conflict.

### Скрипт оценки организатора

Распознаватель отвечает по контракту из `eval.zip` — плоский JSON, скрипт читает только `slug`:

```
./participant_test.sh --images-dir ./queries --manifest ./queries.tsv \
  --endpoint 'http://127.0.0.1:8080/v1/eval/predict' --output ./predictions.jsonl
```

Нужны bash, curl и jq (на Windows — Git Bash). Полный ответ эндпоинта —
`{"slug", "confidence", "candidates", "ocr_text", "box", "ms"}`, где `candidates` — топ-5
с уверенностью каждого.

`--min-visual 0.4` включает отказ `"slug": null` для вин вне каталога: на 700 синтетических
кадрах он не срабатывает ни разу, а обе чужие бутылки из контрольных фото ловит. По умолчанию
порог выключен — сервис всегда отвечает, как требует README организатора.

## HTTP-интерфейсы

| Сервис | Порт | Ручки |
|---|---|---|
| `recognizer` | 8080 | `POST /v1/recognize` (внутренняя, сигналы для API), `POST /v1/eval/predict` (контракт организатора), `GET /health` |
| `api` | 8787 | `POST /v1/recognitions` (multipart `image`), `GET /v1/health`, `GET /docs`, `/v1/admin/*` |
| `web` | 3000 | сканер, `/admin` — очередь разметки |

`POST /v1/recognitions`: JPEG, PNG или WebP до 10 МБ, короткая сторона от 200 px; формат
определяется по сигнатуре файла. Ответ — `matched` / `ambiguous` (карточка + `confidence` +
альтернативы) либо `not_found` с причиной `unreadable` или `not_in_catalog`. «Не нашли» — это
тоже `200`: ответ, а не ошибка. Схемы и коды ошибок — `platform/contract`, машинный вид —
`platform/contract/openapi.json` (OpenAPI 3.1).

## Переменные окружения

Секретов в репозитории нет; `.env` в `.gitignore`, рядом с каждым пакетом лежит `.env.example`.

Корень (`.env.example`) — скрипты каталога, миграций и оценки:

| | |
|---|---|
| `DATABASE_URL` | Postgres с каталогом. Для самоподписанного TLS — `?sslmode=no-verify` |
| `VINO_API_BASE` | открытое API vino-svoe.ru, откуда зеркалим каталог |

Распознаватель:

| | |
|---|---|
| `WINVINO_DATA_DIR` | где лежат модель и каталог; в репозитории это `artifacts/`, в образе `/data` |
| `ML_PYTHON`, `OCR_PYTHON` | интерпретаторы двух venv |
| `RECOGNIZER_MAX_IN_FLIGHT` | сверх этого числа кадров в очереди — 503 (по умолчанию 4) |
| `EVAL_MIN_VISUAL` | порог отказа «нет в каталоге», только для `/v1/eval/predict` |

API (`platform/api/.env.example` — там же значения по умолчанию и пороги решения):

| | |
|---|---|
| `RECOGNIZER` | `mock` или `model` |
| `RECOGNIZER_URL`, `RECOGNIZE_TIMEOUT_MS` | адрес распознавателя и таймаут |
| `DATABASE_URL`, `CATALOG_REFRESH_MS` | каталог для карточек; держится в памяти, обновляется раз в 10 мин |
| `MODEL_*` | пороги `matched` / `ambiguous` / `not_found`, обоснование — в `modelRecognizer.ts` |
| `SCAN_ARCHIVE`, `SCAN_ARCHIVE_DIR`, `MATCHER_VERSION` | архив прод-сканов для дообучения |
| `ADMIN_PASSWORD` | включает раздел разметки; пусто — роутов `/v1/admin/*` нет вовсе |

Веб: `WINVINO_API_URL` (**зашивается в сборку** — сменили, пересоберите) и тот же
`ADMIN_PASSWORD`. Бот: `TELEGRAM_BOT_TOKEN`, `WINVINO_API_URL`, `WEB_APP_URL`.

## Проверки

```
npm run selftest                       # матчер по рендерам каталога
npm run recognizer:eval                # офлайн-оценка (нужен исходный датасет от организатора)
cd platform && npm run check           # typecheck + lint + unit и контрактные тесты всех пакетов
npm run e2e -w @winvino/web            # Playwright, системный Edge
```

## Карта репозитория

| | |
|---|---|
| `artifacts/` | модель, индекс референсов и каталог для матчера — всё, что нужно для инференса |
| `ml/` | обучение, синтетика, локатор, эмбеддинги, экспорт бандла (Python) |
| `ocr/` | PaddleOCR: воркер и окружение (Python) |
| `scripts/` | распознаватель, оценка, миграции, синхронизация каталога, матчер (Node) |
| `platform/` | `contract` (zod + OpenAPI), `api` (Hono), `web` (Next.js), `bot` |
| `migrations/` | схема каталога и таблицы сканов; применяются `npm run db:migrate` |
| `deploy/` | Dockerfile'ы четырёх сервисов и entrypoint распознавателя |
| `docs/` | [DATABASE](docs/DATABASE.md) — база и матчер, [DEPLOY](docs/DEPLOY.md) — прод |

