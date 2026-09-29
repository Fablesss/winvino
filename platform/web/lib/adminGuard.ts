import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import {
  ADMIN_COOKIE,
  ADMIN_COOKIE_PATH,
  ADMIN_SESSION_TTL_MS,
  adminPassword,
  createAdminSessionToken,
  isAdminSessionValid,
} from "./adminSession";

export const ADMIN_LOGIN_PATH = "/admin/login";

/**
 * Проверка сессии стоит в каждой странице и в роуте выдачи фото, а не в layout: layout в Next
 * не перерисовывается при переходах внутри раздела и роуты-обработчики через себя не пропускает,
 * так что на него полагаться нельзя.
 *
 * Раздела нет вовсе (пароль не задан) — 404, а не редирект на вход: наружу не должно торчать даже
 * то, что здесь что-то есть.
 */
export async function requireAdminSession(): Promise<void> {
  const password = adminPassword();
  if (!password) notFound();
  const token = (await cookies()).get(ADMIN_COOKIE)?.value;
  if (!isAdminSessionValid(token, password)) redirect(ADMIN_LOGIN_PATH);
}

/** То же для роута фото: там нужен не редирект, а пустой отказ. */
export async function hasAdminSession(): Promise<boolean> {
  const password = adminPassword();
  if (!password) return false;
  const token = (await cookies()).get(ADMIN_COOKIE)?.value;
  return isAdminSessionValid(token, password);
}

/**
 * Secure — по протоколу самого запроса, а не по NODE_ENV: в деплое Traefik всегда отдаёт
 * x-forwarded-proto: https, а прод-сборка, поднятая локально или в локальной сети по http
 * (например чтобы потыкать разметку с телефона), иначе молча не пускала бы внутрь — браузер
 * выбросил бы Secure-cookie, и вход выглядел бы как неверный пароль.
 */
async function isHttpsRequest(): Promise<boolean> {
  const forwarded = (await headers()).get("x-forwarded-proto");
  return forwarded?.split(",")[0]?.trim() === "https";
}

export async function startAdminSession(password: string): Promise<void> {
  (await cookies()).set({
    name: ADMIN_COOKIE,
    value: createAdminSessionToken(password),
    httpOnly: true,
    sameSite: "lax",
    secure: await isHttpsRequest(),
    path: ADMIN_COOKIE_PATH,
    maxAge: Math.floor(ADMIN_SESSION_TTL_MS / 1000),
  });
}

export async function endAdminSession(): Promise<void> {
  (await cookies()).delete({ name: ADMIN_COOKIE, path: ADMIN_COOKIE_PATH });
}
