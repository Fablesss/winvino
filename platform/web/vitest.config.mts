import path from "node:path";
import { defineConfig } from "vitest/config";

// e2e/*.spec.ts — это Playwright (npm run e2e), vitest их не трогает.
export default defineConfig({
  // Тот же алиас, что в tsconfig: без него не импортировать модуль из app/, который тянет @/lib.
  resolve: { alias: { "@": path.resolve(import.meta.dirname) } },
  test: { include: ["{lib,components,app}/**/*.test.{ts,tsx}"] },
});
