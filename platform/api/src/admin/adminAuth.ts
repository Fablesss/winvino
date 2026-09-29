import { createHash, timingSafeEqual } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';
import { respondWithApiError } from '../apiError.ts';

const BEARER_PREFIX = 'Bearer ';

/**
 * Сравнение постоянного времени, причём по sha256, а не по самим строкам: обычное `===`
 * выходит из цикла на первом различии, и по времени ответа пароль подбирается посимвольно,
 * а сравнение сырых буферов выдало бы ещё и его длину.
 */
function isSameSecret(given: string, expected: string): boolean {
  const digest = (value: string) => createHash('sha256').update(value, 'utf8').digest();
  return timingSafeEqual(digest(given), digest(expected));
}

/**
 * Единственный замок раздела разметки: общий секрет в заголовке. Ходит сюда только сервер веба
 * (серверные компоненты /admin), браузер этого токена никогда не видит — у него своя cookie.
 */
export function requireAdminPassword(password: string): MiddlewareHandler {
  return async (c, next) => {
    const header = c.req.header('Authorization') ?? '';
    const token = header.startsWith(BEARER_PREFIX) ? header.slice(BEARER_PREFIX.length) : '';
    if (!isSameSecret(token, password)) {
      return respondWithApiError(c, 'UNAUTHORIZED');
    }
    await next();
  };
}
