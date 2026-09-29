import { defineConfig, devices } from "@playwright/test";
import { ADMIN_E2E } from "./e2e/adminEnv";

const WEB_PORT = 3100;
/** Совпадает с дефолтом WINVINO_API_URL: адрес прокси зашивается в сборку веба. */
const API_HEALTH_URL = "http://127.0.0.1:8787/v1/health";

const { password: ADMIN_PASSWORD, scansDir: SCAN_ARCHIVE_DIR } = ADMIN_E2E;

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./test-results",
  timeout: 30_000,
  reporter: "list",
  use: {
    ...devices["Pixel 7"],
    baseURL: `http://127.0.0.1:${WEB_PORT}`,
    // Браузер из системы: скачивание Chromium с CDN Playwright здесь недоступно.
    channel: process.env.PLAYWRIGHT_CHANNEL ?? "msedge",
    locale: "ru-RU",
  },
  webServer: [
    {
      command: "npm run start -w @winvino/api",
      cwd: "..",
      url: API_HEALTH_URL,
      env: {
        MOCK_RECOGNIZER_DELAY_MS: "300",
        ACCESS_LOG: "off",
        // Очередь разметки поднимается только вместе с базой; без DATABASE_URL её роутов не будет.
        ...(process.env.DATABASE_URL ? { DATABASE_URL: process.env.DATABASE_URL, ADMIN_PASSWORD } : {}),
        SCAN_ARCHIVE_DIR,
      },
      reuseExistingServer: true,
    },
    {
      // Production-сборка: service worker регистрируется только в ней.
      command: `npm run build && npx next start -p ${WEB_PORT}`,
      url: `http://127.0.0.1:${WEB_PORT}`,
      timeout: 240_000,
      env: { ADMIN_PASSWORD },
      reuseExistingServer: false,
    },
  ],
});
