import { ADMIN_PASSWORD_MIN_LENGTH } from '@winvino/contract';
import { z } from 'zod';
import { DEFAULT_MODEL_THRESHOLDS, type ModelThresholds } from './recognizer/modelRecognizer.ts';

/** Единственное место, где API читает окружение. Дальше конфиг передаётся явно. */
const ApiEnvSchema = z
  .object({
    HOST: z.string().min(1).default('127.0.0.1'),
    PORT: z.coerce.number().int().min(1).max(65535).default(8787),
    /** Через запятую или `*`. Нативным клиентам и боту CORS не нужен — только браузерам с чужого origin. */
    CORS_ORIGINS: z.string().default('*'),
    RECOGNIZER: z.enum(['mock', 'model']).default('mock'),
    RECOGNIZE_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
    /** Искусственная задержка мока — чтобы клиенты видели состояние загрузки как с моделью. */
    MOCK_RECOGNIZER_DELAY_MS: z.coerce.number().int().nonnegative().default(700),
    ACCESS_LOG: z.enum(['on', 'off']).default('on'),

    // ── RECOGNIZER=model ──
    /** Сервис распознавания (scripts/serve-recognizer.mjs), например http://recognizer:8080. */
    RECOGNIZER_URL: z.url().optional(),
    /** Postgres с каталогом вин: карточки вин для ответа берутся оттуда. */
    DATABASE_URL: z.string().min(1).optional(),
    CATALOG_REFRESH_MS: z.coerce.number().int().positive().default(10 * 60_000),
    MODEL_MATCHED_MIN_CONFIDENCE: z.coerce.number().min(0).max(1).default(DEFAULT_MODEL_THRESHOLDS.matchedMinConfidence),
    MODEL_NOT_IN_CATALOG_MAX_VISUAL: z.coerce.number().min(-1).max(1).default(DEFAULT_MODEL_THRESHOLDS.notInCatalogMaxVisual),
    MODEL_UNREADABLE_MAX_OCR_LETTERS: z.coerce.number().int().nonnegative().default(DEFAULT_MODEL_THRESHOLDS.unreadableMaxOcrLetters),
    MODEL_MAX_ALTERNATIVES: z.coerce.number().int().nonnegative().default(DEFAULT_MODEL_THRESHOLDS.maxAlternatives),

    // ── Архив прод-сканов ──
    /** on — каждое распознавание сохраняется: фото на диск, строка в label_scans. Нужен DATABASE_URL. */
    SCAN_ARCHIVE: z.enum(['on', 'off']).default('off'),
    SCAN_ARCHIVE_DIR: z.string().min(1).default('./data/scans'),
    /** Чем получено предсказание — версия релиза модели, например siglip2-b16-ft1-e4. */
    MATCHER_VERSION: z.string().min(1).optional(),

    // ── Очередь разметки (/v1/admin/*) ──
    /**
     * Общий секрет раздела разметки: им же веб подписывает свою cookie сессии. Не задан —
     * роуты /v1/admin/* не регистрируются и отвечают 404, то есть наружу по умолчанию ничего
     * не торчит. Короткий пароль тут бессмысленен: единственная защита от перебора — длина.
     */
    ADMIN_PASSWORD: z.string().min(ADMIN_PASSWORD_MIN_LENGTH).optional(),
  })
  .superRefine((vars, ctx) => {
    if (vars.RECOGNIZER === 'model') {
      for (const key of ['RECOGNIZER_URL', 'DATABASE_URL'] as const) {
        if (!vars[key]) ctx.addIssue({ code: 'custom', path: [key], message: 'обязательна при RECOGNIZER=model' });
      }
    }
    if (vars.SCAN_ARCHIVE === 'on' && !vars.DATABASE_URL) {
      ctx.addIssue({ code: 'custom', path: ['DATABASE_URL'], message: 'обязательна при SCAN_ARCHIVE=on' });
    }
    if (vars.ADMIN_PASSWORD && !vars.DATABASE_URL) {
      ctx.addIssue({ code: 'custom', path: ['DATABASE_URL'], message: 'обязательна при заданном ADMIN_PASSWORD' });
    }
  });

export type ModelRecognizerConfig = {
  url: string;
  databaseUrl: string;
  catalogRefreshMs: number;
  thresholds: ModelThresholds;
};

export type ScanArchiveConfig = {
  dir: string;
  databaseUrl: string;
  /** null — версия не задана в окружении, подставится имя распознавателя. */
  matcherVersion: string | null;
};

export type AdminConfig = {
  password: string;
  databaseUrl: string;
  /** Тот же каталог, куда пишет архив сканов: очередь показывает уже сохранённые фото. */
  scansDir: string;
};

export type ApiConfig = {
  host: string;
  port: number;
  corsOrigins: '*' | string[];
  recognizer: 'mock' | 'model';
  recognizeTimeoutMs: number;
  mockRecognizerDelayMs: number;
  isAccessLogEnabled: boolean;
  /** Заполнено только при RECOGNIZER=model. */
  model: ModelRecognizerConfig | null;
  /** Заполнено только при SCAN_ARCHIVE=on. */
  scanArchive: ScanArchiveConfig | null;
  /** Заполнено только при заданном ADMIN_PASSWORD; null — раздела разметки нет. */
  admin: AdminConfig | null;
};

export class ApiConfigError extends Error {
  constructor(issues: string[]) {
    super(`неверное окружение API:\n  ${issues.join('\n  ')}`);
    this.name = 'ApiConfigError';
  }
}

/**
 * Compose подставляет незаданную необязательную переменную пустой строкой (`${MATCHER_VERSION:-}`),
 * и Dokploy пишет то же самое для пустого поля в Environment. Считаем её отсутствующей: иначе
 * `.optional()` и `.default()` не срабатывают и API падает на старте в цикле перезапусков.
 */
function withoutEmptyValues(env: Record<string, string | undefined>): Record<string, string | undefined> {
  return Object.fromEntries(Object.entries(env).filter(([, value]) => value?.trim() !== ''));
}

export function loadApiConfig(env: Record<string, string | undefined>): ApiConfig {
  const parsed = ApiEnvSchema.safeParse(withoutEmptyValues(env));
  if (!parsed.success) {
    throw new ApiConfigError(parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`));
  }
  const vars = parsed.data;
  const corsOrigins = vars.CORS_ORIGINS.trim() === '*'
    ? '*'
    : vars.CORS_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean);
  const model = vars.RECOGNIZER === 'model' && vars.RECOGNIZER_URL && vars.DATABASE_URL
    ? {
      url: vars.RECOGNIZER_URL,
      databaseUrl: vars.DATABASE_URL,
      catalogRefreshMs: vars.CATALOG_REFRESH_MS,
      thresholds: {
        matchedMinConfidence: vars.MODEL_MATCHED_MIN_CONFIDENCE,
        notInCatalogMaxVisual: vars.MODEL_NOT_IN_CATALOG_MAX_VISUAL,
        unreadableMaxOcrLetters: vars.MODEL_UNREADABLE_MAX_OCR_LETTERS,
        maxAlternatives: vars.MODEL_MAX_ALTERNATIVES,
      },
    }
    : null;
  const scanArchive = vars.SCAN_ARCHIVE === 'on' && vars.DATABASE_URL
    ? { dir: vars.SCAN_ARCHIVE_DIR, databaseUrl: vars.DATABASE_URL, matcherVersion: vars.MATCHER_VERSION ?? null }
    : null;
  const admin = vars.ADMIN_PASSWORD && vars.DATABASE_URL
    ? { password: vars.ADMIN_PASSWORD, databaseUrl: vars.DATABASE_URL, scansDir: vars.SCAN_ARCHIVE_DIR }
    : null;
  return {
    host: vars.HOST,
    port: vars.PORT,
    corsOrigins,
    recognizer: vars.RECOGNIZER,
    recognizeTimeoutMs: vars.RECOGNIZE_TIMEOUT_MS,
    mockRecognizerDelayMs: vars.MOCK_RECOGNIZER_DELAY_MS,
    isAccessLogEnabled: vars.ACCESS_LOG === 'on',
    model,
    scanArchive,
    admin,
  };
}
