import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { ADMIN_PASSWORD_MIN_LENGTH } from "@winvino/contract";

/**
 * Сессия разметчика: срок жизни плюс подпись, и больше ничего. Ни пароля, ни имени в cookie нет,
 * подделать её без пароля нельзя, а сам пароль браузер видит один раз — в форме входа.
 *
 * Ключ подписи — сам ADMIN_PASSWORD, отдельного секрета в окружении нет специально: смена
 * пароля обязана разлогинивать всех, и с общим ключом это выходит само, без списка сессий.
 *
 * Модуль намеренно без next/headers: чистые функции проверяются юнит-тестом, работа с cookie —
 * в lib/adminGuard.ts.
 */
export const ADMIN_COOKIE = "winvino_admin";

/** Путь cookie: она не уезжает в запросы сканера и в прокси /api/*. */
export const ADMIN_COOKIE_PATH = "/admin";

export const ADMIN_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const TOKEN_SEPARATOR = ".";

/**
 * Пароль раздела разметки или null, если раздела нет. Пустая строка — это «не задан»: compose и
 * Dokploy пишут незаданную переменную как `VAR=`. Слишком короткий пароль тоже отключает раздел,
 * ровно как в API (loadApiConfig), иначе веб пускал бы внутрь, а API отвечал бы ему 401.
 */
export function adminPassword(): string | null {
  const password = process.env.ADMIN_PASSWORD?.trim();
  return password && password.length >= ADMIN_PASSWORD_MIN_LENGTH ? password : null;
}

/**
 * Сравнение пароля на входе — постоянного времени и по sha256: обычное `===` выходит из цикла
 * на первом различии, а сравнение сырых строк выдало бы ещё и длину.
 */
export function isAdminPassword(given: string, password: string): boolean {
  const digest = (value: string) => createHash("sha256").update(value, "utf8").digest();
  return timingSafeEqual(digest(given), digest(password));
}

function signature(expiresAt: number, password: string): string {
  return createHmac("sha256", password).update(String(expiresAt)).digest("base64url");
}

export function createAdminSessionToken(password: string, now = Date.now()): string {
  const expiresAt = now + ADMIN_SESSION_TTL_MS;
  return `${expiresAt}${TOKEN_SEPARATOR}${signature(expiresAt, password)}`;
}

export function isAdminSessionValid(token: string | undefined, password: string, now = Date.now()): boolean {
  if (!token) return false;
  const separatorAt = token.indexOf(TOKEN_SEPARATOR);
  if (separatorAt <= 0) return false;
  const expiresAt = Number(token.slice(0, separatorAt));
  if (!Number.isFinite(expiresAt) || expiresAt <= now) return false;
  // Срок подписан вместе с подписью, поэтому продлить сессию правкой cookie не получится.
  const given = Buffer.from(token.slice(separatorAt + 1));
  const expected = Buffer.from(signature(expiresAt, password));
  return given.length === expected.length && timingSafeEqual(given, expected);
}
