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

## Команды

Node ≥ 24: API и контракт исполняются из `.ts` напрямую, без сборки (type stripping).

```
npm install              # из platform/
npm run dev:api          # API на http://127.0.0.1:8787 (+ /docs — интерактивная документация)
npm run dev:web          # веб на http://localhost:3000, /api/* проксируется на API
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

Мок отвечает детерминированно по sha256 фото: одно фото — один ответ. Примерно 60% фото
дают `matched`, 25% — `ambiguous`, 15% — `not_found`. Вина — 10 реальных из каталога.

## Telegram Mini App

- SDK (`telegram-web-app.js`) грузится, только если страница открыта из Telegram (в hash есть
  `tgWebApp…`). PWA от telegram.org не зависит.
- Тема клиента (`--tg-theme-*`) подменяет палитру. Цвет поля за бутылкой — цвет самого вина,
  от темы он не зависит.
- `MainButton` на экране результата — «Сканировать ещё». Съёмка — только кнопкой на странице:
  файловый диалог в веб-вью открывается лишь по настоящему жесту пользователя, а нажатие
  `MainButton` таким жестом не считается.
- `BackButton` и системное «назад» ведут через историю браузера к съёмке.
- Для web.telegram.org (там мини-апп открывается в iframe) отдаётся
  `Content-Security-Policy: frame-ancestors 'self' https://web.telegram.org`. Поэтому
  `X-Frame-Options: DENY` сюда добавлять нельзя.

Подключение: в @BotFather — `/newapp` или кнопка меню с HTTPS-адресом веба. Для разработки
хватает одного туннеля (ngrok, cloudflared) на порт веба: API идёт через тот же origin по `/api`.

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
