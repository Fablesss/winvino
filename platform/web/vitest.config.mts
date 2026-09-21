import { defineConfig } from "vitest/config";

// e2e/*.spec.ts — это Playwright (npm run e2e), vitest их не трогает.
export default defineConfig({
  test: { include: ["{lib,components,app}/**/*.test.{ts,tsx}"] },
});
