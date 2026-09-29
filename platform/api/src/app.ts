import {
  API_ROUTES,
  API_VERSION,
  buildOpenApiDocument,
  MAX_IMAGE_BYTES,
  REQUEST_ID_HEADER,
  type Health,
} from '@winvino/contract';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import { requestId } from 'hono/request-id';
import { createAdminRoutes, type AdminDeps } from './admin/adminRoutes.ts';
import { respondWithApiError } from './apiError.ts';
import type { ApiConfig } from './config.ts';
import { createRecognizeHandler, MULTIPART_ENVELOPE_BYTES } from './recognizeRoute.ts';
import type { Recognizer } from './recognizer/recognizer.ts';
import type { ScanArchive } from './scans/scanArchive.ts';

export type AppDeps = {
  config: Pick<ApiConfig, 'corsOrigins' | 'recognizeTimeoutMs' | 'isAccessLogEnabled'>;
  recognizer: Recognizer;
  /** Архив прод-сканов; null или отсутствует — распознавания нигде не сохраняются. */
  archive?: ScanArchive | null;
  /** Очередь разметки; null или отсутствует — роутов /v1/admin/* нет вообще, они отдают 404. */
  admin?: AdminDeps | null;
};

const CORS_MAX_AGE_SECONDS = 600;
const API_DOCS_PATH = '/docs';

/** Scalar с CDN: интерактивная документация без зависимости в пакете. */
const API_DOCS_HTML = `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><title>winvino API</title>
<meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body><script id="api-reference" data-url="${API_ROUTES.openApi}"></script>
<script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script></body></html>`;

export function createApp({ config, recognizer, archive, admin }: AppDeps): Hono {
  const app = new Hono();
  const openApiDocument = buildOpenApiDocument();

  app.use(requestId({ headerName: REQUEST_ID_HEADER }));
  app.use(
    cors({
      origin: config.corsOrigins,
      allowMethods: ['GET', 'POST', 'OPTIONS'],
      exposeHeaders: [REQUEST_ID_HEADER],
      maxAge: CORS_MAX_AGE_SECONDS,
    }),
  );
  if (config.isAccessLogEnabled) {
    app.use(async (c, next) => {
      const startedAt = performance.now();
      await next();
      console.log(
        JSON.stringify({
          event: 'request',
          requestId: c.get('requestId'),
          method: c.req.method,
          path: c.req.path,
          status: c.res.status,
          ms: Math.round(performance.now() - startedAt),
        }),
      );
    });
  }

  app.get(API_ROUTES.health, (c) => {
    const health: Health = { status: 'ok', apiVersion: API_VERSION, recognizer: recognizer.name };
    return c.json(health);
  });
  app.get(API_ROUTES.openApi, (c) => c.json(openApiDocument));
  app.get(API_DOCS_PATH, (c) => c.html(API_DOCS_HTML));

  app.post(
    API_ROUTES.recognitions,
    bodyLimit({
      maxSize: MAX_IMAGE_BYTES + MULTIPART_ENVELOPE_BYTES,
      onError: (c) => respondWithApiError(c, 'IMAGE_TOO_LARGE', { details: { maxBytes: MAX_IMAGE_BYTES } }),
    }),
    createRecognizeHandler({ recognizer, recognizeTimeoutMs: config.recognizeTimeoutMs, archive }),
  );

  if (admin) app.route('/', createAdminRoutes(admin));

  app.notFound((c) => respondWithApiError(c, 'NOT_FOUND', { details: { method: c.req.method, path: c.req.path } }));
  app.onError((error, c) => {
    console.error(JSON.stringify({ event: 'unhandled_error', requestId: c.get('requestId'), message: error.message, stack: error.stack }));
    return respondWithApiError(c, 'INTERNAL_ERROR');
  });

  return app;
}
