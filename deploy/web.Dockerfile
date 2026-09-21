# Веб (platform/web, Next.js: Telegram Mini App + PWA). Контекст сборки — platform/.
#
# Адрес API зашивается при сборке: rewrites /api → WINVINO_API_URL попадают в манифест
# маршрутов. Внутри compose это http://api:8787; сменили — пересоберите образ.

FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY contract/package.json contract/
COPY api/package.json api/
COPY web/package.json web/
RUN npm ci -w @winvino/web -w @winvino/contract
COPY contract/ contract/
COPY web/ web/
ARG WINVINO_API_URL=http://api:8787
ENV WINVINO_API_URL=$WINVINO_API_URL NEXT_OUTPUT=standalone NEXT_TELEMETRY_DISABLED=1
RUN npm run build -w @winvino/web

# standalone: трассировка от корня workspace, поэтому сервер лежит в web/server.js.
FROM node:24-bookworm-slim
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000 NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=build /app/web/.next/standalone ./
COPY --from=build /app/web/.next/static ./web/.next/static
COPY --from=build /app/web/public ./web/public
USER node
EXPOSE 3000
HEALTHCHECK --interval=20s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "web/server.js"]
