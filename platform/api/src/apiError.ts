import { API_ERROR_HTTP_STATUS, MAX_IMAGE_BYTES, type ApiErrorBody, type ApiErrorCode } from '@winvino/contract';
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

/** Сообщения по умолчанию: по-русски и такие, что их можно показать пользователю как есть. */
const DEFAULT_ERROR_MESSAGES: Record<ApiErrorCode, string> = {
  INVALID_REQUEST: 'Ожидается multipart/form-data с фото в поле «image».',
  IMAGE_REQUIRED: 'Не пришло фото: добавьте файл в поле «image».',
  NOT_FOUND: 'Такого адреса в API нет.',
  IMAGE_TOO_LARGE: `Фото больше ${MAX_IMAGE_BYTES / 1024 / 1024} МБ. Уменьшите его и отправьте снова.`,
  UNSUPPORTED_IMAGE_TYPE: 'Поддерживаются только фото в JPEG, PNG и WebP.',
  IMAGE_UNREADABLE: 'Не удалось открыть фото: файл повреждён или это не изображение.',
  IMAGE_TOO_SMALL: 'Фото слишком маленькое — снимите этикетку крупнее.',
  INTERNAL_ERROR: 'На сервере что-то сломалось. Попробуйте ещё раз.',
  RECOGNIZER_UNAVAILABLE: 'Распознавание сейчас недоступно. Попробуйте через минуту.',
};

/** Все ошибки API проходят здесь: статус берётся из контракта, формат тела — один. */
export function respondWithApiError(
  c: Context,
  code: ApiErrorCode,
  options: { message?: string; details?: Record<string, unknown> } = {},
): Response {
  const body: ApiErrorBody = {
    error: {
      code,
      message: options.message ?? DEFAULT_ERROR_MESSAGES[code],
      requestId: c.get('requestId') ?? null,
      ...(options.details ? { details: options.details } : {}),
    },
  };
  return c.json(body, API_ERROR_HTTP_STATUS[code] satisfies ContentfulStatusCode);
}
