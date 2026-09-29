import path from "node:path";

/**
 * Окружение e2e раздела разметки: одни значения нужны конфигу Playwright (он задаёт их серверам),
 * другие — фикстурам (они пишут в ту же базу и тот же каталог фото). Поэтому отдельный модуль,
 * а не константы в playwright.config.ts: тот не импортируется ничем, кроме самого Playwright.
 *
 * DATABASE_URL берём из .env в корне репозитория — без него раздел разметки не поднимается и
 * спека admin.spec.ts пропускается целиком.
 */
try {
  process.loadEnvFile(path.join(__dirname, "..", "..", "..", ".env"));
} catch {
  // .env нет — значит и раздел разметки в этом прогоне не проверяется.
}

export const ADMIN_E2E = {
  /** Пароль на время прогона: не короче ADMIN_PASSWORD_MIN_LENGTH. */
  password: "e2e-razmetka-parol",
  /** Фото сканов, которые заводит тест: тот же каталог видят API и фикстуры. */
  scansDir: path.join(__dirname, "..", "e2e-scans"),
  databaseUrl: process.env.DATABASE_URL,
};
