# winvino platform

Единое API распознавания вина по фото этикетки и веб-клиент для него. Веб — одна
Next.js-страница, которая работает и как Telegram Mini App, и как PWA. Телеграм-бот и
нативные приложения подключаются к тому же API по тому же контракту.

Отдельный npm-workspace: корневой `package.json` репозитория (каталог, OCR, модель) он не
трогает.

| Пакет | Что внутри |
|---|---|
| `contract/` | zod-схемы API v1, коды ошибок, генерация OpenAPI, fetch-клиент на TypeScript. **Единственный источник правды о контракте** |
| `api/` | Hono на Node 24: `POST /v1/recognitions`, проверка фото, мок-распознаватель |
| `web/` | Next.js 16: Mini App + PWA, одна страница |
| `bot/` | Telegram-бот: фото в чат → карточка вина. Второй клиент того же API |

## Команды

Node ≥ 24: API и контракт исполняются из `.ts` напрямую, без сборки (type stripping).

```
npm install              # из platform/
npm run dev:api          # API на http://127.0.0.1:8787 (+ /docs — интерактивная документация)
npm run dev:web          # веб на http://localhost:3000, /api/* проксируется на API
npm run dev:bot          # бот (long polling); нужен bot/.env с TELEGRAM_BOT_TOKEN, см. bot/.env.example
npm run check            # typecheck + lint + unit/контрактные тесты всех пакетов
npm run e2e -w @winvino/web   # Playwright: сборка + прогон в системном Edge
npm run openapi:write    # перегенерировать contract/openapi.json после правки схем
```

## Контракт v1

`POST /v1/recognitions`, `multipart/form-data`, поле `image`: JPEG, PNG или WebP до 10 МБ,
короткая сторона от 200px. Формат определяется по сигнатуре файла. HEIC отклоняется с
подсказкой сконвертировать в JPEG. Клиентам стоит ужимать фото до 1600px по длинной стороне.

Ответ `200` — `Recognition`:

- `status: matched | ambiguous` — есть `match` (вино + `confidence` 0–1) и `alternatives`;
- `status: not_found` — `match: null`, `reason: unreadable` (переснять) или `not_in_catalog`.

«Не нашли» — это тоже `200`: не ошибка запроса, а ответ. Ошибки приходят как
`{ error: { code, message, requestId, details? } }`. `message` по-русски, его можно
показывать пользователю. Коды и HTTP-статусы — в `contract/src/errors.ts`.

Правила совместимости, на которые рассчитывают клиенты:

- новые поля в ответе и новые коды ошибок добавляются без смены версии: клиент игнорирует
  незнакомые поля, а незнакомый `code` обрабатывает как общую ошибку по HTTP-статусу;
- удалить или переименовать поле, добавить новый `status` — ломающее изменение, только в `/v2`.

Что брать разным клиентам:

- **TypeScript (веб, бот на Node):** `createWinvinoClient({ baseUrl })` из `@winvino/contract`;
- **нативные приложения и всё прочее:** генерация по `contract/openapi.json` (OpenAPI 3.1,
  именованные компоненты `Wine`, `Recognition`, `ApiError`, …). Тест падает, если файл отстал
  от схем.

Заголовок `X-Request-Id` можно прислать свой (например, id апдейта в боте) — он вернётся в
ответе и в теле ошибки.

## Распознаватель: мок и модель

`RECOGNIZER=mock` (по умолчанию) — заглушка, `RECOGNIZER=model` — настоящая модель:

```
RECOGNIZER=model RECOGNIZER_URL=http://127.0.0.1:8080 DATABASE_URL=postgresql://… npm run dev:api
```

- Фото уходит в сервис распознавания (`scripts/serve-recognizer.mjs` в корне репозитория,
  `POST /v1/recognize`). Он отдаёт топ-5 слагов с уверенностью, сходство лучшего референса
  и число прочитанных OCR букв; решение принимает API (`api/src/recognizer/modelRecognizer.ts`).
- Карточки вин — из Postgres тем же SELECT, что выгрузил мок-каталог (`CatalogWineRow` →
  `wineFromCatalogRow`). Каталог грузится в память при старте и обновляется раз в
  `CATALOG_REFRESH_MS`: обрыв базы после старта не ломает ответы. Пока каталога нет — 503.
- Решение: `matched` при уверенности лидера ≥ 0.8, иначе `ambiguous` с тремя альтернативами;
  `not_found`, если сходство лучшего референса < 0.4: `unreadable`, когда OCR прочитал не
  больше 3 букв (переснять), иначе `not_in_catalog`. Обоснование порогов — в
  `modelRecognizer.ts` и `docs/RECOGNIZER.md`; переопределяются переменными `MODEL_*`.
- Слаги, которых нет в каталоге сайта (модель обучена на выгрузке, где их больше), в ответ
  не попадают.
- Сервис распознавания поднимается, перезапускает воркер или занят → `503 RECOGNIZER_UNAVAILABLE`.

Новая реализация — тип `Recognizer` (`api/src/recognizer/recognizer.ts`) + ветка в
`createRecognizer` (`api/src/server.ts`) + значение `RECOGNIZER` (`api/src/config.ts`).
Контракт и клиенты при этом не меняются. Ответ распознавателя API ещё раз проверяет схемой:
кривой ответ станет `500 INTERNAL_ERROR` с записью `recognizer_contract_violation` в логе
и не дойдёт до клиентов. Зависший распознаватель прерывается через `RECOGNIZE_TIMEOUT_MS`
и превращается в `503`.

## Архив прод-сканов

`SCAN_ARCHIVE=on` (нужен `DATABASE_URL`) — каждое распознавание сохраняется: фото файлом в
`SCAN_ARCHIVE_DIR` под именем-sha256, строка — в `label_scans` с `source='production'` и тем
же `id`, что ушёл клиенту. Это вход для дообучения: эталон (`truth_wine_slug`) проставляется
потом руками. Запись идёт мимо ответа и свои сбои гасит в лог — `api/src/scans/scanArchive.ts`,
колонки описаны в `docs/DATABASE.md`.

Мок отвечает детерминированно по sha256 фото: одно фото — один ответ. Примерно 60% фото
дают `matched`, 25% — `ambiguous`, 15% — `not_found`. Вина — 10 реальных из каталога.

## Telegram Mini App

- SDK (`telegram-web-app.js`) грузится, только если страница открыта из Telegram (в hash есть
  `tgWebApp…`). PWA от telegram.org не зависит.
- Палитра всегда своя: тема клиента (`--tg-theme-*`) на цвета не влияет, а цвет окна
  (`setHeaderColor`/`setBackgroundColor`) выставляется фирменный по `colorScheme`.
- `MainButton` на экране результата — «Сканировать ещё». Съёмка — только кнопкой на странице:
  файловый диалог в веб-вью открывается лишь по настоящему жесту пользователя, а нажатие
  `MainButton` таким жестом не считается.
- `BackButton` и системное «назад» ведут через историю браузера к съёмке.
- Для web.telegram.org (там мини-апп открывается в iframe) отдаётся
  `Content-Security-Policy: frame-ancestors 'self' https://web.telegram.org`. Поэтому
  `X-Frame-Options: DENY` сюда добавлять нельзя.

Подключение: в @BotFather — `/newapp` или кнопка меню с HTTPS-адресом веба. Для разработки
хватает одного туннеля (ngrok, cloudflared) на порт веба: API идёт через тот же origin по `/api`.

## Telegram-бот

`bot/` — long polling (`getUpdates`), без вебхука: публичный адрес и порт не нужны. Зависимостей
Telegram нет — тонкий клиент Bot API в `bot/src/telegram/botApi.ts`.

- Фото в чат (или картинка файлом до 10 МБ) → `getFile` → `POST /v1/recognitions` через
  `createWinvinoClient`. `X-Request-Id` = `update_id`: по нему запрос ищется и в логах API, и в
  логах бота (JSON-строки с `updateId`). Из размеров фото берётся наибольший не длиннее 1600px.
- `matched`/`ambiguous` — фото бутылки с карточкой в подписи, кнопки «Карточка в каталоге» и
  «Открыть сканер» (Mini App, `WEB_APP_URL`). Для `ambiguous` — «Не уверены…» и похожие вина
  ссылками на каталог. `not_found` — подсказка по `reason`. Ошибка API — её `message` и номер запроса.
- Тексты — `bot/src/replies.ts`, чистые функции.
- Кнопку Mini App Telegram пускает только в личных чатах — в группах бот отвечает без неё.
- Апдейты обрабатываются параллельно; подтверждаются сразу после выдачи, так что фото, на
  котором процесс упал, повторно не придёт.

Подводные камни:

- **Фото бутылки нельзя отдать Telegram ссылкой.** Ресайзер каталога отвечает WebP с прозрачным
  фоном и `Content-Type: application/octet-stream`, а `sendPhoto` по URL требует верный MIME. Бот
  скачивает картинку и загружает её JPEG-ом (`sharp`, фон — цвет бумаги веба, холст 3:4). Не
  вышло — та же карточка уходит текстом.
- **FormData из Node переводит `\n` в строковых полях в `\r\n`** (так велит спецификация), поэтому
  multipart для `sendPhoto` собирается вручную (`encodeMultipart`).
- **Один токен — один процесс.** Второй `getUpdates` с тем же токеном получает 409 Conflict, как и
  бот с настроенным вебхуком. Для разработки заведите отдельного бота в @BotFather.

## Дизайн

Визуальный язык взят с мобильной версии `vino-svoe.ru` (страница `/wines`): бумага `#fefdfa`,
кремовые карточки `#fdf9ed`, бордо `#8f3d42`, заголовки Playfair Display, текст — system-ui,
радиусы 12/16/24/32. Все токены — в `web/app/globals.css`; цвета, нужные вне CSS (манифест,
иконки, окно Telegram), продублированы в `web/app/brand.ts`.

Фирменные картинки — в `web/public/brand/`. Логотип и иллюстрация сканера нарисованы тёмным
по кремовому, поэтому рядом лежат перекрашенные `*-dark.svg`, а `<picture>` выбирает вариант
по `prefers-color-scheme`. Тёмной темы на сайте нет — её палитра наша, но из тех же оттенков.
Бейдж рейтинга (`.rating-badge`) и цвет вина (`.wine-swatch-*`) от темы не зависят.

## PWA

Manifest — `web/app/manifest.ts`, иконки генерирует `npm run icons -w @winvino/web`.
Service worker (`web/public/sw.js`) кеширует оболочку и `/_next/static`; `/api` всегда идёт в
сеть. Регистрируется только в production-сборке и не внутри Telegram.

## Подводные камни

- **Адрес API зашивается в сборку веба.** Rewrites Next попадают в манифест маршрутов при
  `next build`. Сменили `WINVINO_API_URL` — пересоберите (проверено: `next start` с другим
  значением продолжает ходить на старый адрес).
- **e2e гоняется в системном Edge** (`channel: msedge`): CDN Playwright отсюда недоступен.
  Другой браузер — через `PLAYWRIGHT_CHANNEL`.
- **Тесты на Windows:** даже `setTimeout(0)` спит там ~15 мс, поэтому мок с
  `delayMs: 0` таймер не заводит.
