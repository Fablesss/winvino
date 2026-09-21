import { z } from 'zod';
import { API_ERROR_HTTP_STATUS, type ApiErrorCode } from './errors.ts';
import {
  ACCEPTED_IMAGE_TYPES,
  MAX_IMAGE_BYTES,
  MIN_IMAGE_SIDE_PX,
  RECOGNITION_IMAGE_FIELD,
  RECOMMENDED_MAX_IMAGE_SIDE_PX,
} from './recognition.ts';
import { API_ROUTES, REQUEST_ID_HEADER } from './routes.ts';
import { openApiComponents } from './schemaRegistry.ts';

/** Версия документа. Добавили поле или код ошибки — minor; сломали — новый /v2. */
export const OPENAPI_DOCUMENT_VERSION = '1.0.0';

export type OpenApiDocument = {
  openapi: '3.1.0';
  info: { title: string; version: string; description: string };
  servers?: Array<{ url: string }>;
  paths: Record<string, unknown>;
  components: { schemas: Record<string, unknown>; headers: Record<string, unknown> };
};

const schemaRef = (id: string) => ({ $ref: `#/components/schemas/${id}` });
const requestIdHeader = { [REQUEST_ID_HEADER]: { $ref: '#/components/headers/RequestId' } };

function buildComponentSchemas(): Record<string, unknown> {
  const { schemas } = z.toJSONSchema(openApiComponents, {
    uri: (id) => `#/components/schemas/${id}`,
    // Ответы должны расширяться без поломки клиентов: сгенерированный по
    // additionalProperties: false клиент отверг бы ответ с новым полем.
    override: ({ jsonSchema }) => {
      if (jsonSchema.additionalProperties === false) delete jsonSchema.additionalProperties;
    },
  });
  // $schema и $id на каждом компоненте в OpenAPI — шум, диалект задаёт сам документ.
  return Object.fromEntries(
    Object.entries(schemas).map(([id, { $schema: _dialect, $id: _uri, ...schema }]) => [id, schema]),
  );
}

/** Ответы-ошибки, сгруппированные по HTTP-статусу: у одного статуса бывает несколько кодов. */
function buildErrorResponses(codes: ApiErrorCode[]): Record<string, unknown> {
  const codesByStatus = new Map<number, ApiErrorCode[]>();
  for (const code of codes) {
    const status = API_ERROR_HTTP_STATUS[code];
    codesByStatus.set(status, [...(codesByStatus.get(status) ?? []), code]);
  }
  return Object.fromEntries(
    [...codesByStatus].map(([status, statusCodes]) => [
      String(status),
      {
        description: `Коды: ${statusCodes.join(', ')}`,
        headers: requestIdHeader,
        content: { 'application/json': { schema: schemaRef('ApiError') } },
      },
    ]),
  );
}

export function buildOpenApiDocument(options: { serverUrl?: string } = {}): OpenApiDocument {
  return {
    openapi: '3.1.0',
    info: {
      title: 'winvino API',
      version: OPENAPI_DOCUMENT_VERSION,
      description: [
        'Распознавание российского вина по фото этикетки. Один контракт для Telegram Mini App,',
        'Telegram-бота, PWA и нативных приложений.',
        '',
        'Ошибки приходят в едином формате `ApiError`. Незнакомый клиенту `code` обрабатывается',
        'как общая ошибка по HTTP-статусу — новые коды добавляются без смены версии.',
      ].join('\n'),
    },
    ...(options.serverUrl ? { servers: [{ url: options.serverUrl }] } : {}),
    paths: {
      [API_ROUTES.recognitions]: {
        post: {
          operationId: 'recognizeLabel',
          summary: 'Распознать вино по фото этикетки',
          description: [
            `Фото — поле \`${RECOGNITION_IMAGE_FIELD}\` в multipart/form-data.`,
            `Форматы: ${ACCEPTED_IMAGE_TYPES.join(', ')} (по сигнатуре файла; HEIC — конвертировать в JPEG).`,
            `До ${MAX_IMAGE_BYTES / 1024 / 1024} МБ, короткая сторона не меньше ${MIN_IMAGE_SIDE_PX}px.`,
            `Рекомендуется ужать до ${RECOMMENDED_MAX_IMAGE_SIDE_PX}px по длинной стороне.`,
          ].join('\n'),
          requestBody: {
            required: true,
            content: {
              'multipart/form-data': {
                schema: {
                  type: 'object',
                  required: [RECOGNITION_IMAGE_FIELD],
                  properties: { [RECOGNITION_IMAGE_FIELD]: { type: 'string', format: 'binary' } },
                },
                encoding: { [RECOGNITION_IMAGE_FIELD]: { contentType: ACCEPTED_IMAGE_TYPES.join(', ') } },
              },
            },
          },
          responses: {
            '200': {
              description: 'Распознавание выполнено. «Не нашли» — тоже 200, со status = not_found',
              headers: requestIdHeader,
              content: { 'application/json': { schema: schemaRef('Recognition') } },
            },
            ...buildErrorResponses([
              'INVALID_REQUEST',
              'IMAGE_REQUIRED',
              'IMAGE_TOO_LARGE',
              'UNSUPPORTED_IMAGE_TYPE',
              'IMAGE_UNREADABLE',
              'IMAGE_TOO_SMALL',
              'INTERNAL_ERROR',
              'RECOGNIZER_UNAVAILABLE',
            ]),
          },
        },
      },
      [API_ROUTES.health]: {
        get: {
          operationId: 'getHealth',
          summary: 'Проверка живости',
          responses: {
            '200': {
              description: 'Сервис жив',
              headers: requestIdHeader,
              content: { 'application/json': { schema: schemaRef('Health') } },
            },
          },
        },
      },
      [API_ROUTES.openApi]: {
        get: {
          operationId: 'getOpenApiDocument',
          summary: 'Этот документ',
          responses: { '200': { description: 'OpenAPI 3.1', content: { 'application/json': {} } } },
        },
      },
    },
    components: {
      schemas: buildComponentSchemas(),
      headers: {
        RequestId: { description: 'Id запроса для логов и поддержки', schema: { type: 'string' } },
      },
    },
  };
}
