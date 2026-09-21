import { z } from 'zod';
import type { ApiErrorCode } from './errors.ts';
import { RECOGNITION_IMAGE_FIELD, RecognitionSchema, type Recognition } from './recognition.ts';
import { API_ROUTES, HealthSchema, REQUEST_ID_HEADER, type Health } from './routes.ts';

/** Ошибки, которые рождаются на клиенте, а не приходят от сервера. */
export type ClientErrorCode = 'NETWORK_ERROR' | 'INVALID_RESPONSE';

/** `string & {}` — код, которого этот клиент ещё не знает: сервер добавил новый. */
export type WinvinoErrorCode = ApiErrorCode | ClientErrorCode | (string & {});

export class WinvinoApiError extends Error {
  readonly code: WinvinoErrorCode;
  /** null — до сервера не достучались. */
  readonly httpStatus: number | null;
  readonly requestId: string | null;
  readonly details: Record<string, unknown> | undefined;

  constructor(init: {
    code: WinvinoErrorCode;
    message: string;
    httpStatus: number | null;
    requestId: string | null;
    details?: Record<string, unknown>;
    cause?: unknown;
  }) {
    super(init.message, { cause: init.cause });
    this.name = 'WinvinoApiError';
    this.code = init.code;
    this.httpStatus = init.httpStatus;
    this.requestId = init.requestId;
    this.details = init.details;
  }
}

export type WinvinoClientOptions = {
  /** Без завершающего слэша. Пустая строка — тот же origin, что у страницы. */
  baseUrl: string;
  fetch?: typeof fetch;
  headers?: Record<string, string>;
};

export type RequestOptions = { signal?: AbortSignal };

export type WinvinoClient = {
  recognizeLabel(image: Blob, options?: RequestOptions & { filename?: string }): Promise<Recognition>;
  fetchHealth(options?: RequestOptions): Promise<Health>;
};

/** Тело ошибки разбираем мягко: код строкой, чтобы новый серверный код не превращался в INVALID_RESPONSE. */
const LenientErrorBodySchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    requestId: z.string().nullable().optional(),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
});

const DEFAULT_IMAGE_FILENAME = 'label.jpg';
const NETWORK_ERROR_MESSAGE = 'Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.';
const INVALID_RESPONSE_MESSAGE = 'Сервер ответил в неожиданном формате. Попробуйте ещё раз позже.';

/** Работает в браузере, Node 18+ и везде, где есть fetch, FormData и Blob. */
export function createWinvinoClient(options: WinvinoClientOptions): WinvinoClient {
  const baseUrl = options.baseUrl.replace(/\/+$/, '');
  const fetchImpl = options.fetch ?? ((input, init) => globalThis.fetch(input, init));

  async function requestJson<T>(path: string, init: RequestInit, schema: z.ZodType<T>): Promise<T> {
    let response: Response;
    try {
      response = await fetchImpl(`${baseUrl}${path}`, {
        ...init,
        headers: { Accept: 'application/json', ...options.headers },
      });
    } catch (cause) {
      // Отмену вызывающий инициировал сам — отдаём как есть, чтобы её можно было отличить.
      if (init.signal?.aborted) throw cause;
      throw new WinvinoApiError({
        code: 'NETWORK_ERROR',
        message: NETWORK_ERROR_MESSAGE,
        httpStatus: null,
        requestId: null,
        cause,
      });
    }

    const requestId = response.headers.get(REQUEST_ID_HEADER);
    const body: unknown = await response.json().catch(() => undefined);

    if (!response.ok) {
      const errorBody = LenientErrorBodySchema.safeParse(body);
      throw new WinvinoApiError(
        errorBody.success
          ? {
              code: errorBody.data.error.code,
              message: errorBody.data.error.message,
              httpStatus: response.status,
              requestId: errorBody.data.error.requestId ?? requestId,
              details: errorBody.data.error.details,
            }
          : { code: 'INVALID_RESPONSE', message: INVALID_RESPONSE_MESSAGE, httpStatus: response.status, requestId },
      );
    }

    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      throw new WinvinoApiError({
        code: 'INVALID_RESPONSE',
        message: INVALID_RESPONSE_MESSAGE,
        httpStatus: response.status,
        requestId,
        details: { issues: parsed.error.issues },
      });
    }
    return parsed.data;
  }

  return {
    recognizeLabel(image, { filename = DEFAULT_IMAGE_FILENAME, signal } = {}) {
      const form = new FormData();
      form.append(RECOGNITION_IMAGE_FIELD, image, filename);
      return requestJson(API_ROUTES.recognitions, { method: 'POST', body: form, signal }, RecognitionSchema);
    },
    fetchHealth({ signal } = {}) {
      return requestJson(API_ROUTES.health, { method: 'GET', signal }, HealthSchema);
    },
  };
}
