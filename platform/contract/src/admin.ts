import { z } from 'zod';
import { RECOGNITION_STATUSES } from './recognition.ts';
import { API_VERSION } from './routes.ts';

/**
 * Очередь разметки прод-сканов: внутренняя поверхность API, не контракт для клиентов.
 * Схемы сознательно НЕ регистрируются в openApiComponents — публичный OpenAPI описывает то,
 * что вызывают мини-апп, бот и нативные клиенты, а этим ходит только раздел /admin веба.
 * Типы всё равно живут в контракте: у API и веба они должны быть одни, а не две копии.
 *
 * Доступ ко всем роутам — `Authorization: Bearer <ADMIN_PASSWORD>`; пароль не задан в
 * окружении API — роуты не зарегистрированы вообще и отвечают 404.
 */
export const ADMIN_ROUTE_PREFIX = `/${API_VERSION}/admin`;

export const ADMIN_ROUTES = {
  scans: `${ADMIN_ROUTE_PREFIX}/scans`,
  wines: `${ADMIN_ROUTE_PREFIX}/wines`,
  scan: (scanId: string) => `${ADMIN_ROUTE_PREFIX}/scans/${scanId}`,
  scanTruth: (scanId: string) => `${ADMIN_ROUTE_PREFIX}/scans/${scanId}/truth`,
  scanImage: (scanId: string) => `${ADMIN_ROUTE_PREFIX}/scans/${scanId}/image`,
} as const;

/** pending — эталона ещё нет; labeled — уже размечен (нужен, чтобы переразметить). */
export const ADMIN_SCAN_FILTERS = ['pending', 'labeled'] as const;

export const ADMIN_SCANS_PAGE_SIZE = 20;
export const ADMIN_WINE_SEARCH_LIMIT = 8;

/**
 * Минимальная длина ADMIN_PASSWORD. Значение общее для API и веба: иначе с коротким паролем
 * веб бы пускал в раздел, а API отвечал бы ему 401 — и разметчик видел бы пустые ошибки.
 */
export const ADMIN_PASSWORD_MIN_LENGTH = 12;

export const AdminScanFilterSchema = z.enum(ADMIN_SCAN_FILTERS);

export const AdminScanQuerySchema = z.object({
  filter: AdminScanFilterSchema.default('pending'),
  limit: z.coerce.number().int().min(1).max(50).default(ADMIN_SCANS_PAGE_SIZE),
  /** Курсор из nextCursor предыдущей страницы; без него — с самого свежего скана. */
  cursor: z.string().min(1).optional(),
});

export const AdminWineSearchQuerySchema = z.object({
  q: z.string().trim().min(2).describe('Часть названия вина или винодельни'),
  limit: z.coerce.number().int().min(1).max(50).default(ADMIN_WINE_SEARCH_LIMIT),
});

/**
 * Вино в интерфейсе разметчика. `title = null` — слага уже нет в зеркале каталога
 * (вино снято с продажи, а в скане предсказание с ним осталось); показывать тогда слаг.
 */
export const AdminWineOptionSchema = z.object({
  slug: z.string().min(1),
  title: z.string().nullable(),
  manufacturerName: z.string().nullable(),
});

export const AdminScanCandidateSchema = AdminWineOptionSchema.extend({
  confidence: z.number().describe('Уверенность распознавателя, 0–1'),
});

/** Ключи одинаковы у всех вариантов — как в Recognition: разбирать проще. */
export const AdminScanTruthSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none'), wine: z.null() }),
  z.object({ kind: z.literal('wine'), wine: AdminWineOptionSchema }),
  z.object({ kind: z.literal('absent'), wine: z.null() }),
]);

export const AdminScanSchema = z.object({
  id: z.uuid().describe('Тот же id, что ушёл клиенту в ответе распознавания'),
  createdAt: z.iso.datetime(),
  imageSha256: z.string().nullable(),
  matcherVersion: z.string().nullable(),
  /** Что показали пользователю; null — в строке нет candidates (сканы не из прода). */
  status: z.enum(RECOGNITION_STATUSES).nullable(),
  reason: z.string().nullable().describe('Причина отказа: unreadable | not_in_catalog'),
  processingMs: z.number().int().nonnegative().nullable(),
  /** Из колонок predicted_wine_slug/predicted_score: с candidates[0] совпадает не всегда. */
  predicted: AdminScanCandidateSchema.nullable(),
  candidates: z.array(AdminScanCandidateSchema).describe('Топ распознавателя по убыванию уверенности'),
  truth: AdminScanTruthSchema,
  truthRank: z.number().int().positive().nullable().describe('Позиция эталона в топе; null — не попал'),
});

export const AdminScanPageSchema = z.object({
  items: z.array(AdminScanSchema),
  /** null — страница последняя. */
  nextCursor: z.string().nullable(),
  pendingTotal: z.number().int().nonnegative().describe('Сколько прод-сканов ещё без эталона'),
});

export const AdminWineSearchSchema = z.object({ items: z.array(AdminWineOptionSchema) });

export const AdminScanResultSchema = z.object({ scan: AdminScanSchema });

/**
 * Три действия разметчика. `confirm` берёт эталон из предсказания — отдельный вариант, а не
 * `wine` со слагом с клиента: разметчик подтверждает именно то, что показано, и подмена
 * слага по дороге не превратит «верно» в другое вино.
 */
export const AdminTruthInputSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('confirm') }),
  z.object({ kind: z.literal('wine'), slug: z.string().min(1) }),
  z.object({ kind: z.literal('absent') }),
]);

export type AdminScanFilter = z.infer<typeof AdminScanFilterSchema>;
export type AdminScanQuery = z.infer<typeof AdminScanQuerySchema>;
export type AdminWineSearchQuery = z.infer<typeof AdminWineSearchQuerySchema>;
export type AdminWineOption = z.infer<typeof AdminWineOptionSchema>;
export type AdminScanCandidate = z.infer<typeof AdminScanCandidateSchema>;
export type AdminScanTruth = z.infer<typeof AdminScanTruthSchema>;
export type AdminScan = z.infer<typeof AdminScanSchema>;
export type AdminScanPage = z.infer<typeof AdminScanPageSchema>;
export type AdminWineSearch = z.infer<typeof AdminWineSearchSchema>;
export type AdminTruthInput = z.infer<typeof AdminTruthInputSchema>;
