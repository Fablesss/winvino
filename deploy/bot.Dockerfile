# Telegram-бот (platform/bot). Контекст сборки — platform/.
# Long polling: бот сам ходит в Telegram, портов наружу нет. TypeScript исполняется Node 24
# напрямую (type stripping), сборки нет.
FROM node:24-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app

# Манифесты всех пакетов workspace — npm ci сверяет lock целиком; ставятся зависимости bot и contract.
COPY package.json package-lock.json ./
COPY contract/package.json contract/
COPY api/package.json api/
COPY web/package.json web/
COPY bot/package.json bot/
RUN npm ci --omit=dev -w @winvino/bot -w @winvino/contract

COPY contract/src contract/src
COPY bot/src bot/src

USER node
CMD ["node", "bot/src/main.ts"]
