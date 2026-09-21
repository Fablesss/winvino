# Деплой через Dokploy

Три сервиса из `docker-compose.yml` в корне репозитория:

| Сервис | Что это | Порт | Наружу |
|---|---|---|---|
| `recognizer` | распознавание по фото: Node + Python (torch — визуал, PaddleOCR — текст). `deploy/recognizer.Dockerfile` | 8080 | нет, только внутренняя сеть |
| `api` | API для всех клиентов (`platform/api`), `RECOGNIZER=model`. `deploy/api.Dockerfile` | 8787 | по желанию — для бота и нативных приложений |
| `web` | Telegram Mini App + PWA (`platform/web`), `/api/*` проксирует в `api`. `deploy/web.Dockerfile` | 3000 | да |

Postgres с каталогом — внешний, по `DATABASE_URL` (тот же, что у синхронизации каталога).

## 1. Артефакты модели

Веса, индекс и каталог (~340 МБ) в git и в образ не входят. Контейнер `recognizer` при старте
качает бандл по `ARTIFACTS_URL`, сверяет sha256 и кладёт в именованный том `recognizer-data`.
При следующих стартах берёт из тома, пока не сменится `ARTIFACTS_SHA256`.

Собрать бандл (на машине, где обучалась модель):

```
npm run bundle:export
# → data/raw/deploy/winvino-recognizer-<тег>.tar.gz и .sha256 рядом
```

Опубликовать в релиз приватного репозитория:

```
gh release create model-<тег> data/raw/deploy/winvino-recognizer-<тег>.tar.gz --repo Fablesss/winvino --title "Модель <тег>" --notes "sha256: <значение из .sha256>"
gh api repos/Fablesss/winvino/releases/tags/model-<тег> --jq ".assets[0].url"
# → https://api.github.com/repos/Fablesss/winvino/releases/assets/<id>  — это ARTIFACTS_URL
```

Для скачивания из приватного релиза нужен токен: GitHub → Settings → Developer settings →
Fine-grained tokens, доступ только к `Fablesss/winvino`, права `Contents: Read-only`. Это
`ARTIFACTS_TOKEN`. Личный токен с правом записи на сервер не кладите.

Текущий бандл: см. раздел «Текущий релиз модели» в конце.

## 2. Сервис в Dokploy

1. **Settings → Git → GitHub**: подключить GitHub App и дать доступ к `Fablesss/winvino`.
2. **Project → Create Service → Compose**. Provider — GitHub, репозиторий `Fablesss/winvino`,
   ветка `master`, Compose Path — `./docker-compose.yml`.
3. **Environment** (Dokploy пишет в `.env` рядом с compose, compose подставляет `${…}`):

   ```
   DATABASE_URL=postgresql://user:password@host:5432/winvino
   ARTIFACTS_URL=https://api.github.com/repos/Fablesss/winvino/releases/assets/<id>
   ARTIFACTS_SHA256=<sha256 бандла>
   ARTIFACTS_TOKEN=<fine-grained токен, Contents: Read-only>
   # по желанию:
   CORS_ORIGINS=*                 # origin браузерных клиентов с чужих доменов
   RECOGNIZE_TIMEOUT_MS=30000
   RECOGNIZER_MAX_IN_FLIGHT=4
   ```

   Для базы с самоподписанным TLS — `?sslmode=no-verify` в конце `DATABASE_URL`.
4. **Domains**: `web` → порт `3000`, HTTPS (Let's Encrypt). По желанию `api` → порт `8787` —
   если бот или нативное приложение ходят в API напрямую, а не через веб. Traefik-метки
   Dokploy добавляет сам; сети `dokploy-network` у `web` и `api` уже прописаны в compose.
5. **Deploy**. Первая сборка долгая (~10–20 мин): образ распознавателя тянет torch (CPU),
   PaddlePaddle и веса детектора и OCR — они запекаются в образ, в рантайме сервис в интернет
   не ходит. Первый старт `recognizer` качает бандл и грузит модели; пока не готов, его
   `/health` отвечает 503, а API на распознавание — `503 RECOGNIZER_UNAVAILABLE`.

Проверка: открыть домен веба и отсканировать бутылку; `https://<домен api>/v1/health` →
`{"status":"ok","recognizer":"model"}`. Логи распознавателя: `артефакты: …`, затем
`распознаватель готов: siglip2-b16-ft1-e4, референсов 2096 …`.

Telegram Mini App: в @BotFather — `/newapp` или кнопка меню с HTTPS-адресом веба.

## 3. Обновления

- **Код**: пуш в `master` → Deploy (или автодеплой по webhook в Dokploy).
- **Модель**: новый бандл → новый релиз → сменить `ARTIFACTS_URL` и `ARTIFACTS_SHA256` →
  Deploy. Распознаватель скачает новый бандл поверх старого в томе.
- **Адрес API для веба** зашит при сборке (`WINVINO_API_URL=http://api:8787` в compose). Внутри
  compose менять его не нужно.

## 4. Ресурсы

- `recognizer`: ~2.5 ГБ RAM (две модели в двух процессах), чем больше ядер — тем быстрее.
  Замер на CPU i5-4440 (4 ядра, 2013 г.): визуал ~3 с + OCR ~2 с на фото. Кадры
  обрабатываются по одному; сверх `RECOGNIZER_MAX_IN_FLIGHT` в очереди — 503.
- `api` и `web` — по ~100–200 МБ.
- Образ распознавателя — по оценке ~3 ГБ (не собирался, см. ниже). Том с артефактами —
  ~0.4 ГБ (архив после распаковки удаляется; пик во время загрузки ~0.75 ГБ).

## 5. Надёжность

- Упавший или зависший Python-воркер перезапускается сам (пауза 1 → 30 с); на время
  перезапуска распознаватель отвечает 503, API — `RECOGNIZER_UNAVAILABLE`.
- Каталог вин API держит в памяти и обновляет раз в 10 минут: короткий обрыв базы после
  старта ответы не ломает. Без базы при старте распознавание отвечает 503, пока база не появится.
- Healthcheck есть у всех трёх контейнеров; `restart: unless-stopped`.

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

## Что проверено и что нет

На машине разработки нет Docker, поэтому **образы ни разу не собирались** — первая настоящая
сборка пройдёт на сервере. Проверено без Docker:

- «образы» api и web собраны во временных папках ровно по спискам `COPY` из Dockerfile, с теми
  же `npm ci` (флаги workspace, `--omit=dev`) и standalone-сборкой Next; запущены и прогнан
  путь «веб → /api-прокси → API → распознаватель → база»;
- «образ» распознавателя — те же файлы, запуск из распакованного бандла с `HF_HUB_OFFLINE=1`,
  прогон `participant_test.sh`;
- скачивание бандла из приватного релиза по токену и сверка sha256 — тем же `curl` и
  `sha256sum`, что в entrypoint.

Не проверено и может потребовать правок на первой сборке: установка Linux-колёс из
lock-файлов (снимались с Windows-окружений; особенно `paddlepaddle==3.2.0` и
`opencv-contrib-python` под Python 3.12), загрузка весов PaddleOCR при сборке образа, работа
PaddleOCR и torch на Linux-CPU сервера.

## Текущий релиз модели

| | |
|---|---|
| Тег | `siglip2-b16-ft1-e4` |
| Архив | `winvino-recognizer-siglip2-b16-ft1-e4.tar.gz`, 340.8 МБ |
| sha256 | `5d341c7d9a482c8f038ed8f2178501f194e1716fce267486e676a42fecf32016` |
