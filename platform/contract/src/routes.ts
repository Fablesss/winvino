import { z } from 'zod';
import { openApiComponents } from './schemaRegistry.ts';

export const API_VERSION = 'v1';

/** Пути API относительно базового URL. Клиенты строят URL только отсюда. */
export const API_ROUTES = {
  recognitions: `/${API_VERSION}/recognitions`,
  health: `/${API_VERSION}/health`,
  openApi: `/${API_VERSION}/openapi.json`,
} as const;

/** Заголовок с id запроса: есть в каждом ответе и в теле ошибки. */
export const REQUEST_ID_HEADER = 'X-Request-Id';

export const HealthSchema = z
  .object({
    status: z.literal('ok'),
    apiVersion: z.literal(API_VERSION),
    recognizer: z.string().describe('Какой распознаватель отвечает: mock — заглушка, пока нет модели'),
  })
  .register(openApiComponents, { id: 'Health' });

export type Health = z.infer<typeof HealthSchema>;
