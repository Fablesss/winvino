import { z } from 'zod';
import { openApiComponents } from './schemaRegistry.ts';

/**
 * Коды ошибок API и их HTTP-статусы — единственный источник правды для сервера,
 * OpenAPI и клиентов. Новый код — не ломающее изменение: клиент обязан обрабатывать
 * незнакомый код как общую ошибку по HTTP-статусу.
 */
export const API_ERROR_HTTP_STATUS = {
  INVALID_REQUEST: 400,
  IMAGE_REQUIRED: 400,
  UNAUTHORIZED: 401,
  NOT_FOUND: 404,
  IMAGE_TOO_LARGE: 413,
  UNSUPPORTED_IMAGE_TYPE: 415,
  IMAGE_UNREADABLE: 422,
  IMAGE_TOO_SMALL: 422,
  INTERNAL_ERROR: 500,
  RECOGNIZER_UNAVAILABLE: 503,
} as const;

export type ApiErrorCode = keyof typeof API_ERROR_HTTP_STATUS;

export const API_ERROR_CODES = Object.keys(API_ERROR_HTTP_STATUS) as [ApiErrorCode, ...ApiErrorCode[]];

export const ApiErrorCodeSchema = z.enum(API_ERROR_CODES).register(openApiComponents, { id: 'ApiErrorCode' });

export const ApiErrorBodySchema = z
  .object({
    error: z.object({
      code: ApiErrorCodeSchema,
      message: z.string().describe('По-русски, можно показать пользователю'),
      requestId: z.string().nullable().describe('Совпадает с заголовком X-Request-Id'),
      details: z.record(z.string(), z.unknown()).optional().describe('Машиночитаемые подробности, например лимит'),
    }),
  })
  .register(openApiComponents, { id: 'ApiError' });

export type ApiErrorBody = z.infer<typeof ApiErrorBodySchema>;
