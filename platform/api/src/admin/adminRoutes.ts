import {
  ADMIN_ROUTE_PREFIX,
  ADMIN_ROUTES,
  AdminScanQuerySchema,
  AdminTruthInputSchema,
  AdminWineSearchQuerySchema,
  type AdminScanPage,
  type AdminScanResultSchema,
  type AdminWineSearch,
} from '@winvino/contract';
import { Hono } from 'hono';
import type { z } from 'zod';
import { respondWithApiError } from '../apiError.ts';
import { requireAdminPassword } from './adminAuth.ts';
import type { AdminImageReader } from './adminImage.ts';
import { parseScanCursor, type AdminStore } from './adminStore.ts';

export type AdminDeps = {
  password: string;
  store: AdminStore;
  readImage: AdminImageReader;
};

const SCAN_ID_PARAM = 'scanId';
const SCAN_ID_PATTERN = `:${SCAN_ID_PARAM}`;

/** Фото не меняется (имя файла — хеш содержимого), но оно чужое: только приватный кеш. */
const IMAGE_CACHE_CONTROL = 'private, max-age=300';

const TRUTH_FAILURE_MESSAGE = {
  scan_not_found: 'Такого скана нет.',
  no_prediction: 'У этого скана нет предсказания — подтверждать нечего, выберите вино или «нет в каталоге».',
  unknown_wine: 'Такого вина нет в каталоге.',
} as const;

/**
 * Очередь разметки прод-сканов. Роуты возвращают ровно схемы контракта (admin.ts), в публичный
 * OpenAPI не попадают и целиком закрыты общим секретом — см. adminAuth.ts.
 */
export function createAdminRoutes({ password, store, readImage }: AdminDeps): Hono {
  const admin = new Hono();

  // Замок один на весь префикс: новый роут разметки закрыт по факту добавления, без напоминаний.
  admin.use(`${ADMIN_ROUTE_PREFIX}/*`, requireAdminPassword(password));

  admin.get(ADMIN_ROUTES.scans, async (c) => {
    const query = AdminScanQuerySchema.safeParse(c.req.query());
    if (!query.success) {
      return respondWithApiError(c, 'INVALID_REQUEST', {
        message: 'Неверные параметры очереди.',
        details: { issues: query.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`) },
      });
    }
    if (query.data.cursor && !parseScanCursor(query.data.cursor)) {
      return respondWithApiError(c, 'INVALID_REQUEST', { message: 'Испорченный курсор страницы.' });
    }
    const page: AdminScanPage = await store.listScans(query.data);
    return c.json(page);
  });

  admin.get(ADMIN_ROUTES.scan(SCAN_ID_PATTERN), async (c) => {
    const scan = await store.getScan(c.req.param(SCAN_ID_PARAM) ?? '');
    if (!scan) return respondWithApiError(c, 'NOT_FOUND', { message: TRUTH_FAILURE_MESSAGE.scan_not_found });
    return c.json({ scan } satisfies z.infer<typeof AdminScanResultSchema>);
  });

  admin.post(ADMIN_ROUTES.scanTruth(SCAN_ID_PATTERN), async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const input = AdminTruthInputSchema.safeParse(body);
    if (!input.success) {
      return respondWithApiError(c, 'INVALID_REQUEST', { message: 'Ожидается действие confirm, wine со слагом или absent.' });
    }
    // Путь задан строкой из контракта, поэтому типам параметр неизвестен; пустой id — просто 404.
    const result = await store.setTruth(c.req.param(SCAN_ID_PARAM) ?? '', input.data);
    if (result.status !== 'saved') {
      const code = result.status === 'scan_not_found' ? 'NOT_FOUND' : 'INVALID_REQUEST';
      // reason в details — чтобы клиент отличал причины отказа, не разбирая текст сообщения.
      return respondWithApiError(c, code, { message: TRUTH_FAILURE_MESSAGE[result.status], details: { reason: result.status } });
    }
    return c.json({ scan: result.scan } satisfies z.infer<typeof AdminScanResultSchema>);
  });

  admin.get(ADMIN_ROUTES.scanImage(SCAN_ID_PATTERN), async (c) => {
    const imagePath = await store.scanImagePath(c.req.param(SCAN_ID_PARAM) ?? '');
    const image = imagePath ? await readImage(imagePath) : null;
    if (!image) return respondWithApiError(c, 'NOT_FOUND', { message: 'Фото этого скана не найдено.' });
    return new Response(image.bytes, {
      headers: { 'Content-Type': image.contentType, 'Cache-Control': IMAGE_CACHE_CONTROL },
    });
  });

  admin.get(ADMIN_ROUTES.wines, async (c) => {
    const query = AdminWineSearchQuerySchema.safeParse(c.req.query());
    if (!query.success) {
      return respondWithApiError(c, 'INVALID_REQUEST', { message: 'Для поиска нужно не меньше двух символов.' });
    }
    const items = await store.searchWines(query.data.q, query.data.limit);
    return c.json({ items } satisfies AdminWineSearch);
  });

  return admin;
}
