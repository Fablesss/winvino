import { expect, test, type Page } from "@playwright/test";
import { ADMIN_E2E } from "./adminEnv";
import { readTruth, removeSeededScans, seedProductionScans, type SeededScan } from "./adminFixtures";

/** Не внутри test-results: Playwright чистит его перед каждым прогоном. */
const SCREENSHOTS_DIR = "e2e-screens";
const QUEUE = "/admin?filter=pending";

/** У каждого теста свой контекст браузера, значит и входить надо в каждом. */
async function signIn(page: Page): Promise<void> {
  await page.goto("/admin/login");
  await page.getByLabel("Пароль раздела").fill(ADMIN_E2E.password);
  await page.getByRole("button", { name: "Войти" }).click();
  await expect(page.getByText(/Без эталона: \d+/)).toBeVisible();
}

test.describe("очередь разметки прод-сканов", () => {
  // Раздел живёт на label_scans и каталоге: без базы его роутов нет вовсе, проверять нечего.
  test.skip(!ADMIN_E2E.databaseUrl, "нет DATABASE_URL в .env — очередь разметки не поднимается");
  test.describe.configure({ mode: "serial" });

  let scans: SeededScan[] = [];

  test.beforeAll(async () => {
    await removeSeededScans();
    scans = await seedProductionScans(2);
  });

  test.afterAll(async () => {
    await removeSeededScans();
  });

  test("аноним не видит ни очереди, ни фото", async ({ page, request }) => {
    await page.goto(QUEUE);
    await expect(page).toHaveURL(/\/admin\/login/);
    await expect(page.getByRole("heading", { name: "Разметка сканов" })).toBeVisible();
    // Списка на странице входа нет — ни карточек, ни снимков.
    await expect(page.locator("article")).toHaveCount(0);

    const scan = scans[0]!;
    const photo = await request.get(`/admin/scans/${scan.id}/image`);
    // 404, а не 401: адрес не должен подтверждать, что такой скан есть.
    expect(photo.status()).toBe(404);

    await page.getByLabel("Пароль раздела").fill("sovsem-drugoy-parol");
    await page.getByRole("button", { name: "Войти" }).click();
    await expect(page.getByText("Пароль не подошёл.")).toBeVisible();
    await expect(page).toHaveURL(/\/admin\/login/);
  });

  test("вход по паролю: очередь с фото, предсказанием и альтернативой", async ({ page }) => {
    const scan = scans[0]!;
    await signIn(page);
    await page.goto(QUEUE);
    await expect(page.getByRole("heading", { name: "Разметка сканов" })).toBeVisible();

    const photo = page.locator(`img[src="/admin/scans/${scan.id}/image"]`);
    const card = page.locator("article").filter({ has: photo });
    await expect(card).toHaveCount(1);
    await expect(card.getByText(scan.predicted.title, { exact: false }).first()).toBeVisible();
    await expect(card.getByText(scan.alternative.title, { exact: false }).first()).toBeVisible();
    await expect(card.getByText("Лучшая догадка · 62%")).toBeVisible();

    // Снимок именно отрисован: браузер сходил в закрытый роут с cookie и раскодировал картинку.
    await photo.scrollIntoViewIfNeeded();
    await expect
      .poll(() => photo.evaluate((image: HTMLImageElement) => image.naturalWidth))
      .toBeGreaterThan(0);

    await page.screenshot({ path: `${SCREENSHOTS_DIR}/admin-queue.png`, fullPage: false });
  });

  test("«Верно» проставляет эталон из предсказания и убирает скан из очереди", async ({ page }) => {
    const scan = scans[0]!;
    await signIn(page);
    await page.goto(QUEUE);
    const card = page.locator("article").filter({ has: page.locator(`img[src="/admin/scans/${scan.id}/image"]`) });
    await card.getByRole("button", { name: "Верно" }).click();

    await expect(page).toHaveURL(/filter=pending/);
    await expect(card).toHaveCount(0);
    expect(await readTruth(scan.id)).toEqual({ truthWineSlug: scan.predicted.slug, truthAbsent: false, truthRank: 1 });

    await page.goto("/admin?filter=labeled");
    const labeled = page.locator("article").filter({ has: page.locator(`img[src="/admin/scans/${scan.id}/image"]`) });
    await expect(labeled.getByText(`Эталон: ${scan.predicted.title}`)).toBeVisible();
  });

  test("«На самом деле это»: поиск по каталогу переразмечает уже размеченный скан", async ({ page }) => {
    const scan = scans[0]!;
    await signIn(page);
    await page.goto(`/admin/scans/${scan.id}?from=${encodeURIComponent("/admin?filter=labeled")}`);
    await expect(page.getByText(`Эталон: ${scan.predicted.title}`)).toBeVisible();
    await page.screenshot({ path: `${SCREENSHOTS_DIR}/admin-scan.png`, fullPage: true });

    await page.getByPlaceholder("Название вина или винодельни").fill(scan.alternative.title);
    await page.getByRole("button", { name: "Найти" }).click();

    // Именно из выдачи поиска: то же вино есть и в списке кандидатов выше, и его кнопка не считается.
    const search = page.getByTestId("wine-search");
    const found = search.getByRole("button", { name: scan.alternative.title, exact: false });
    await expect(found).toHaveCount(1);
    await found.click();

    await expect(page).toHaveURL(/filter=labeled/);
    expect(await readTruth(scan.id)).toMatchObject({ truthWineSlug: scan.alternative.slug, truthAbsent: false });
  });

  test("«Нет в каталоге» пишет truth_absent и убирает скан из очереди", async ({ page }) => {
    const scan = scans[1]!;
    await signIn(page);
    await page.goto(QUEUE);
    const card = page.locator("article").filter({ has: page.locator(`img[src="/admin/scans/${scan.id}/image"]`) });
    await card.getByRole("button", { name: "Нет в каталоге" }).click();

    await expect(card).toHaveCount(0);
    expect(await readTruth(scan.id)).toEqual({ truthWineSlug: null, truthAbsent: true, truthRank: null });
  });

  test("выход закрывает раздел", async ({ page }) => {
    await signIn(page);
    await page.goto(QUEUE);
    await page.getByRole("button", { name: "Выйти" }).click();
    await expect(page).toHaveURL(/\/admin\/login/);
    await page.goto(QUEUE);
    await expect(page).toHaveURL(/\/admin\/login/);
  });
});
