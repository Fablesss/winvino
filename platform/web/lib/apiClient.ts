import { createWinvinoClient, WinvinoApiError } from "@winvino/contract";

/**
 * Веб ходит в API через свой origin: next.config.ts проксирует /api/* на WINVINO_API_URL.
 * Так мини-аппу нужен один публичный HTTPS-адрес, а не два, и не нужен CORS.
 */
export const WEB_API_BASE_PATH = "/api";

export const winvinoClient = createWinvinoClient({ baseUrl: WEB_API_BASE_PATH });

export type DisplayError = { code: string; message: string; requestId: string | null };

const UNEXPECTED_ERROR_MESSAGE = "Что-то пошло не так. Попробуйте ещё раз.";

/** Сообщения API уже по-русски и годятся для показа; всё прочее — общая фраза. */
export function toDisplayError(error: unknown): DisplayError {
  if (error instanceof WinvinoApiError) {
    return { code: error.code, message: error.message, requestId: error.requestId };
  }
  return { code: "UNEXPECTED", message: UNEXPECTED_ERROR_MESSAGE, requestId: null };
}
