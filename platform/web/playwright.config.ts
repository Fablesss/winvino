import { defineConfig, devices } from "@playwright/test";

const WEB_PORT = 3100;
/** Совпадает с дефолтом WINVINO_API_URL: адрес прокси зашивается в сборку веба. */
const API_HEALTH_URL = "http://127.0.0.1:8787/v1/health";

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
      env: { MOCK_RECOGNIZER_DELAY_MS: "300", ACCESS_LOG: "off" },
      reuseExistingServer: true,
    },
    {
      // Production-сборка: service worker регистрируется только в ней.
      command: `npm run build && npx next start -p ${WEB_PORT}`,
      url: `http://127.0.0.1:${WEB_PORT}`,
      timeout: 240_000,
      reuseExistingServer: false,
    },
  ],
});
