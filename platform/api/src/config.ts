import { z } from 'zod';

/** Единственное место, где API читает окружение. Дальше конфиг передаётся явно. */
const ApiEnvSchema = z.object({
  HOST: z.string().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  /** Через запятую или `*`. Нативным клиентам и боту CORS не нужен — только браузерам с чужого origin. */
  CORS_ORIGINS: z.string().default('*'),
  RECOGNIZER: z.enum(['mock']).default('mock'),
  RECOGNIZE_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  /** Искусственная задержка мока — чтобы клиенты видели состояние загрузки как с моделью. */
  MOCK_RECOGNIZER_DELAY_MS: z.coerce.number().int().nonnegative().default(700),
  ACCESS_LOG: z.enum(['on', 'off']).default('on'),
});

export type ApiConfig = {
  host: string;
  port: number;
  corsOrigins: '*' | string[];
  recognizer: 'mock';
  recognizeTimeoutMs: number;
  mockRecognizerDelayMs: number;
  isAccessLogEnabled: boolean;
};

export class ApiConfigError extends Error {
  constructor(issues: string[]) {
    super(`неверное окружение API:\n  ${issues.join('\n  ')}`);
    this.name = 'ApiConfigError';
  }
}

export function loadApiConfig(env: Record<string, string | undefined>): ApiConfig {
  const parsed = ApiEnvSchema.safeParse(env);
  if (!parsed.success) {
    throw new ApiConfigError(parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`));
  }
  const vars = parsed.data;
  const corsOrigins = vars.CORS_ORIGINS.trim() === '*'
    ? '*'
    : vars.CORS_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean);
  return {
    host: vars.HOST,
    port: vars.PORT,
    corsOrigins,
    recognizer: vars.RECOGNIZER,
    recognizeTimeoutMs: vars.RECOGNIZE_TIMEOUT_MS,
    mockRecognizerDelayMs: vars.MOCK_RECOGNIZER_DELAY_MS,
    isAccessLogEnabled: vars.ACCESS_LOG === 'on',
  };
}
