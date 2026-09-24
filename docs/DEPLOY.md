# Деплой через Dokploy

Сервисы из `docker-compose.yml` в корне репозитория:

| Сервис | Что это | Порт | Наружу |
|---|---|---|---|
| `recognizer` | распознавание по фото: Node + Python (torch — визуал, PaddleOCR — текст). `deploy/recognizer.Dockerfile` | 8080 | нет, только внутренняя сеть |
| `api` | API для всех клиентов (`platform/api`), `RECOGNIZER=model`. `deploy/api.Dockerfile` | 8787 | по желанию — для нативных приложений и внешних клиентов |
| `web` | Telegram Mini App + PWA (`platform/web`), `/api/*` проксирует в `api`. `deploy/web.Dockerfile` | 3000 | да |
| `bot` | Telegram-бот (`platform/bot`), ходит в `api` по внутренней сети. Только с `COMPOSE_PROFILES=bot`. `deploy/bot.Dockerfile` | — | нет: long polling, в Telegram ходит сам |

Postgres с каталогом — внешний, по `DATABASE_URL` (тот же, что у синхронизации каталога).

## 1. Артефакты модели

Веса, индекс и каталог (~355 МБ) лежат в самом репозитории — `artifacts/` — и запекаются в образ
распознавателя при сборке. В рантайме он их не качает: ни внешних адресов, ни токенов для деплоя
не нужно. Чекпойнт разрезан на части по 90 МиБ, потому что GitHub не принимает файлы больше
100 МиБ; стадия `artifacts` в `deploy/recognizer.Dockerfile` склеивает их обратно и сверяет
sha256 по `artifacts/bundle.sha256sums` — битая склейка валит сборку, а не рантайм.

Что внутри (раскладка та же, что у `WINVINO_DATA_DIR`): `model/checkpoints/<чекпойнт>.pt` —
визуальная башня SigLIP2 целиком, `model/index/<тег>-<ключ>.npz` — эмбеддинги референсов,
`model/recognizer.json` — чекпойнт и веса слияния, `dataset/catalog.jsonl` — каталог для
OCR-матчера, `bundle.json` — тег, дата и sha256 каждого файла.

Выложить новую модель после обучения:

```
npm run bundle:export   # → data/raw/deploy/winvino-recognizer-<тег>.tar.gz и bundle.json
npm run bundle:repo     # → artifacts/: файлы бандла, чекпойнт частями, bundle.sha256sums
git add -A artifacts && git commit -m "модель <тег>" && git push
```

`bundle:repo` сверяет sha256 исходных файлов с манифестом (чекпойнт, переписанный после экспорта,
в репозиторий не уедет) и сносит прежнюю раскладку целиком — от старого тега в `artifacts/`
ничего не остаётся. Цена: каждая версия модели ~355 МБ в истории git навсегда, на столько же
растёт клон. Убрать из истории можно только её перезаписью.

Модель можно подменить и без пересборки — бандлом по адресу, см. раздел 8.

Какая модель лежит сейчас: см. «Текущая модель» в конце.

## 2. Сервис в Dokploy

1. **Settings → Git → GitHub**: подключить GitHub App и дать доступ к `Fablesss/winvino`.
2. **Project → Create Service → Compose**. Provider — GitHub, репозиторий `Fablesss/winvino`,
   ветка `master`, Compose Path — `./docker-compose.yml`.
3. **Environment** (Dokploy пишет в `.env` рядом с compose, compose подставляет `${…}`):

   ```
   DATABASE_URL=postgresql://user:password@host:5432/winvino
   # по желанию:
   CORS_ORIGINS=*                 # origin браузерных клиентов с чужих доменов
   RECOGNIZE_TIMEOUT_MS=30000
   RECOGNIZER_MAX_IN_FLIGHT=4
   # Telegram-бот (без этих строк compose его не поднимает):
   COMPOSE_PROFILES=bot
   TELEGRAM_BOT_TOKEN=<токен от @BotFather>
   WEB_APP_URL=https://<домен веба>   # кнопка «Открыть сканер»; без неё — бот без кнопки
   ```

   Для базы с самоподписанным TLS — `?sslmode=no-verify` в конце `DATABASE_URL`.
4. **Domains**: `web` → порт `3000`, HTTPS (Let's Encrypt). По желанию `api` → порт `8787` —
   если нативное приложение или внешний клиент ходят в API напрямую, а не через веб. Боту домен
   не нужен: он в той же compose-сети и ходит в `http://api:8787`. Traefik-метки
   Dokploy добавляет сам; сети `dokploy-network` у `web` и `api` уже прописаны в compose.
5. **Deploy**. Первая сборка долгая (~10–20 мин): образ распознавателя тянет torch (CPU),
   PaddlePaddle, веса детектора и OCR и артефакты модели из `artifacts/` — всё запекается в
   образ, в рантайме сервис в интернет не ходит. На старте `recognizer` поднимает две модели на
   CPU; пока не готов, его `/health` отвечает 503, а API на распознавание —
   `503 RECOGNIZER_UNAVAILABLE`.

Проверка: открыть домен веба и отсканировать бутылку; `https://<домен api>/v1/health` →
`{"status":"ok","recognizer":"model"}`. Лог распознавателя:
`распознаватель готов: siglip2-b16-ft1-e4, референсов 2096 …`.

Telegram Mini App: в @BotFather — `/newapp` или кнопка меню с HTTPS-адресом веба.

Бот: лог `bot` начинается с `{"event":"bot_started","username":"…"}`; фото в чат с ботом →
карточка вина. Токен бота — один на процесс: пока бот крутится на сервере, локально с тем же
токеном его не запускайте (оба получат 409 Conflict). Если у бота когда-то был настроен webhook,
снимите его (`https://api.telegram.org/bot<токен>/deleteWebhook`) — иначе long polling тоже 409.

## 3. Обновления

- **Код**: пуш в `master` → Deploy (или автодеплой по webhook в Dokploy).
- **Модель**: `npm run bundle:export && npm run bundle:repo` → коммит `artifacts/` → пуш →
  Deploy. Образ распознавателя пересобирается (слои с torch и PaddleOCR берутся из кеша, если
  lock-файлы не менялись), модель меняется вместе с кодом и в одном коммите с ним.
- **Адрес API для веба** зашит при сборке (`WINVINO_API_URL=http://api:8787` в compose). Внутри
  compose менять его не нужно.

## 4. Ресурсы

- `recognizer`: ~2.5 ГБ RAM (две модели в двух процессах), чем больше ядер — тем быстрее.
  Замер на CPU i5-4440 (4 ядра, 2013 г.): визуал ~3 с + OCR ~2 с на фото. Кадры
  обрабатываются по одному; сверх `RECOGNIZER_MAX_IN_FLIGHT` в очереди — 503.
- `api`, `web` и `bot` — по ~100–200 МБ.
- Образ распознавателя — по оценке ~3.4 ГБ вместе с артефактами (не собирался, см. ниже). Томов
  у сервисов нет: всё состояние — в базе. Клон репозитория на сборщике — ~0.4 ГБ.

## 5. Надёжность

- Упавший или зависший Python-воркер перезапускается сам (пауза 1 → 30 с); на время
  перезапуска распознаватель отвечает 503, API — `RECOGNIZER_UNAVAILABLE`.
- Каталог вин API держит в памяти и обновляет раз в 10 минут: короткий обрыв базы после
  старта ответы не ломает. Без базы при старте распознавание отвечает 503, пока база не появится.
- Healthcheck есть у `recognizer`, `api` и `web`; у `bot` его нет (нет HTTP) — упавший процесс
  поднимает `restart: unless-stopped`, как и остальные. Сбои связи с Telegram бот переживает сам:
  повторяет `getUpdates` с паузой 1 → 30 с. Отозванный токен — выход с ошибкой в логе.

## 6. Контракт организатора

`POST /v1/eval/predict` живёт на `recognizer`, который наружу не выставлен. Чтобы прогнать
`participant_test.sh` извне, временно назначьте домен сервису `recognizer` на порт 8080.
`EVAL_MIN_VISUAL=0.4` включает отказ `slug: null` для вин вне каталога — только на этом
эндпоинте (см. docs/RECOGNIZER.md, «Вино вне каталога»).

## 7. Локальный запуск того же compose

```
docker network create dokploy-network
# .env с теми же переменными, что в Dokploy
docker compose up --build
# веб — через docker compose port или временный ports: в compose
```

## 8. Бандл по адресу вместо репозитория

Путь на случай, когда модель нужно подменить без пересборки образа (или когда 355 МБ в git
перестанут устраивать). Задайте распознавателю `ARTIFACTS_URL` и `ARTIFACTS_SHA256` — entrypoint
скачает архив, сверит sha256 и распакует поверх запечённых артефактов. Тома у сервиса нет, поэтому
скачивание повторяется при каждом рестарте контейнера; для постоянной работы лучше положить модель
в `artifacts/` и пересобрать.

Опубликовать бандл в релиз приватного репозитория:

```
gh release create model-<тег> data/raw/deploy/winvino-recognizer-<тег>.tar.gz --repo Fablesss/winvino --title "Модель <тег>" --notes "sha256: <значение из .sha256>"
gh api repos/Fablesss/winvino/releases/tags/model-<тег> --jq ".assets[0].url"
# → https://api.github.com/repos/Fablesss/winvino/releases/assets/<id>  — это ARTIFACTS_URL
```

Для скачивания из приватного релиза нужен токен: GitHub → Settings → Developer settings →
Fine-grained tokens, доступ только к `Fablesss/winvino`, права `Contents: Read-only`. Это
`ARTIFACTS_TOKEN`. Личный токен с правом записи на сервер не кладите.

## Что проверено и что нет

На машине разработки нет Docker, поэтому **образы ни разу не собирались** — первая настоящая
сборка пройдёт на сервере. Проверено без Docker:

- «образы» api и web собраны во временных папках ровно по спискам `COPY` из Dockerfile, с теми
  же `npm ci` (флаги workspace, `--omit=dev`) и standalone-сборкой Next; запущены и прогнан
  путь «веб → /api-прокси → API → распознаватель → база»;
- «образ» бота — так же по спискам `COPY` и с `npm ci --omit=dev`; прогнан против API на моке и
  заглушки Bot API (фото, /start, большой файл, группа). С настоящим Telegram не проверялся;
- «образ» распознавателя — те же файлы, запуск из распакованного бандла с `HF_HUB_OFFLINE=1`,
  прогон `participant_test.sh`;
- скачивание бандла из приватного релиза по токену и сверка sha256 — тем же `curl` и
  `sha256sum`, что в entrypoint;
- раскладка `artifacts/` и склейка частей — теми же командами, что в стадии `artifacts`
  (`cat *.part*`, `sha256sum -c bundle.sha256sums`): все четыре файла OK, чекпойнт побайтово
  совпал с исходным (371 787 235 Б). Распознаватель поднят с `WINVINO_DATA_DIR` на склеенной
  копии: `распознаватель готов: siglip2-b16-ft1-e4, референсов 2096`, `/health` → ready, реальное
  фото → верный слаг с уверенностью 0.92.

Не проверено и может потребовать правок на первой сборке: установка Linux-колёс из
lock-файлов (снимались с Windows-окружений; особенно `paddlepaddle==3.2.0` и
`opencv-contrib-python` под Python 3.12), загрузка весов PaddleOCR при сборке образа, работа
PaddleOCR и torch на Linux-CPU сервера.

## Текущая модель

| | |
|---|---|
| Тег | `siglip2-b16-ft1-e4` |
| В репозитории | `artifacts/` — 4 файла бандла, 355 МБ; чекпойнт `ft1-best.pt` четырьмя частями по 90 МиБ |
| Чекпойнт | `model/checkpoints/ft1-best.pt`, sha256 `6cf5770e26baf55d1d68e8be6b765d9a30206cd3c6a242bcfc34e1a61101de2a` |
| Индекс | `model/index/siglip2-b16-ft1-e4-d150d3724f.npz`, 2096 референсов |

Тот же бандл лежит в релизе как резервный путь (раздел 8):

| | |
|---|---|
| Релиз | https://github.com/Fablesss/winvino/releases/tag/model-siglip2-b16-ft1-e4 |
| Архив | `winvino-recognizer-siglip2-b16-ft1-e4.tar.gz`, 340.8 МБ |
| `ARTIFACTS_URL` | `https://api.github.com/repos/Fablesss/winvino/releases/assets/579159331` |
| `ARTIFACTS_SHA256` | `5d341c7d9a482c8f038ed8f2178501f194e1716fce267486e676a42fecf32016` |

Проверено 21.09.2026 тем же `deploy/recognizer-entrypoint.sh` (Git Bash): по токену — 81 с на
скачивание, sha256 совпал, раскладка верная; без токена приватный релиз отвечает 404 и контейнер
падает с понятной ошибкой.
