# API распознавания (platform/api, Hono). Контекст сборки — platform/.
# TypeScript исполняется Node 24 напрямую (type stripping), сборки нет.
FROM node:24-bookworm-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8787
WORKDIR /app

# Манифесты всех пакетов workspace — npm ci сверяет lock целиком; ставятся зависимости api и contract.
COPY package.json package-lock.json ./
COPY contract/package.json contract/
COPY api/package.json api/
COPY web/package.json web/
COPY bot/package.json bot/
RUN npm ci --omit=dev -w @winvino/api -w @winvino/contract

COPY contract/src contract/src
COPY api/src api/src

# Точка монтирования тома со сканами: пустой том наследует владельца этого каталога,
# иначе процесс под node в него не запишет.
RUN mkdir -p /data/scans && chown node:node /data/scans

USER node
EXPOSE 8787
HEALTHCHECK --interval=20s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/v1/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "api/src/server.ts"]
