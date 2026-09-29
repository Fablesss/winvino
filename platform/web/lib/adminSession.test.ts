import { afterEach, describe, expect, it } from "vitest";
import {
  ADMIN_SESSION_TTL_MS,
  adminPassword,
  createAdminSessionToken,
  isAdminPassword,
  isAdminSessionValid,
} from "./adminSession";

const PASSWORD = "razmetka-parol-12";
const NOW = Date.parse("2026-09-29T12:00:00.000Z");

describe("adminPassword", () => {
  afterEach(() => {
    delete process.env.ADMIN_PASSWORD;
  });

  it("считаетРазделВыключеннымБезПароля", () => {
    expect(adminPassword()).toBeNull();
    // Compose и Dokploy пишут незаданную переменную как `VAR=`.
    process.env.ADMIN_PASSWORD = "   ";
    expect(adminPassword()).toBeNull();
  });

  // Иначе веб пускал бы внутрь, а API отвечал бы ему 401: минимум длины у них общий.
  it("короткийПарольТожеВыключаетРаздел", () => {
    process.env.ADMIN_PASSWORD = "korotkiy";
    expect(adminPassword()).toBeNull();
    process.env.ADMIN_PASSWORD = PASSWORD;
    expect(adminPassword()).toBe(PASSWORD);
  });
});

describe("isAdminPassword", () => {
  it("сравниваетТочно", () => {
    expect(isAdminPassword(PASSWORD, PASSWORD)).toBe(true);
    expect(isAdminPassword(`${PASSWORD}x`, PASSWORD)).toBe(false);
    expect(isAdminPassword("", PASSWORD)).toBe(false);
  });
});

describe("сессия разметчика", () => {
  it("своюСвежуюCookieПринимает", () => {
    expect(isAdminSessionValid(createAdminSessionToken(PASSWORD, NOW), PASSWORD, NOW + 1000)).toBe(true);
  });

  // Смена пароля обязана разлогинивать всех: ключ подписи — сам пароль, отдельного секрета нет.
  it("послеСменыПароляСессияНедействительна", () => {
    expect(isAdminSessionValid(createAdminSessionToken(PASSWORD, NOW), "drugoy-parol-12", NOW + 1000)).toBe(false);
  });

  it("протухшуюОтклоняет", () => {
    const token = createAdminSessionToken(PASSWORD, NOW);
    expect(isAdminSessionValid(token, PASSWORD, NOW + ADMIN_SESSION_TTL_MS + 1)).toBe(false);
  });

  // Срок подписан вместе с подписью, поэтому продлить сессию правкой cookie не выйдет.
  it("подменённыйСрокОтклоняет", () => {
    const token = createAdminSessionToken(PASSWORD, NOW);
    const signature = token.slice(token.indexOf(".") + 1);
    const extended = `${NOW + 10 * ADMIN_SESSION_TTL_MS}.${signature}`;
    expect(isAdminSessionValid(extended, PASSWORD, NOW + 1000)).toBe(false);
  });

  it.each(["", "мусор", ".", "123.", `${NOW + 1000}.`, undefined])("мусорВCookieОтклоняет: %o", (token) => {
    expect(isAdminSessionValid(token, PASSWORD, NOW)).toBe(false);
  });
});
