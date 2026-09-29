import { expect, test, type Page } from "@playwright/test";
import { RECOGNITIONS, renderLabelPhoto } from "./fixtures";

const RECOGNITIONS_ROUTE = "**/api/v1/recognitions";
/** Не внутри test-results: Playwright чистит его перед каждым прогоном. */
const SCREENSHOTS_DIR = "e2e-screens";
/** BRAND_COLORS.paper и paperDark, как их отдаёт getComputedStyle. */
const PAPER_LIGHT = "rgb(254, 253, 250)";
const PAPER_DARK = "rgb(26, 22, 20)";

async function stubRecognition(page: Page, body: unknown, status = 200) {
  await page.route(RECOGNITIONS_ROUTE, (route) =>
    route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body), headers: { "X-Request-Id": "req-e2e" } }),
  );
}

async function takeLabelPhoto(page: Page) {
  await page.getByTestId("camera-input").setInputFiles({ name: "label.jpg", mimeType: "image/jpeg", buffer: await renderLabelPhoto() });
}

test.describe("веб / PWA", () => {
  test("фото проходит весь путь через прокси до API и возвращает экран результата", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Узнайте вино по этикетке" })).toBeVisible();
    await page.screenshot({ path: `${SCREENSHOTS_DIR}/capture.png`, fullPage: true });

    const apiResponse = page.waitForResponse(RECOGNITIONS_ROUTE);
    await takeLabelPhoto(page);
    await expect(page.getByText("Читаем этикетку…")).toBeVisible();
    await page.screenshot({ path: `${SCREENSHOTS_DIR}/processing.png` });

    expect((await apiResponse).status()).toBe(200);
    // Мок выбирает сценарий по хешу фото, поэтому допустимы все три исхода.
    await expect(
      page.getByText(/^Совпадение \d+ %$|^Не уверены|^Не удалось прочитать этикетку$|^Этого вина нет в каталоге$/),
    ).toBeVisible();
  });

  test("уверенное совпадение: карточка вина, альтернатива подменяет карточку", async ({ page }) => {
    await stubRecognition(page, RECOGNITIONS.matched);
    await page.goto("/");
    await takeLabelPhoto(page);

    await expect(page.getByRole("heading", { level: 1, name: "Бельбек Рислинг Резерв" })).toBeVisible();
    await expect(page.getByText("Совпадение 93 %")).toBeVisible();
    await expect(page.getByText("10–12 °C")).toBeVisible();
    await expect(page.getByText("Бельбек, Крым")).toBeVisible();
    const bottlePhoto = page.getByRole("img", { name: "Бутылка «Бельбек Рислинг Резерв»" });
    await expect.poll(() => bottlePhoto.evaluate((image: HTMLImageElement) => image.naturalWidth), { timeout: 15_000 }).toBeGreaterThan(0);
    await page.screenshot({ path: `${SCREENSHOTS_DIR}/matched.png`, fullPage: true });
    // Середина карточки: sticky-кнопка должна висеть внизу поверх текста.
    await page.evaluate(() => window.scrollTo(0, 400));
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await expect(page.getByRole("button", { name: "Сканировать ещё" })).toBeInViewport();
    await page.screenshot({ path: `${SCREENSHOTS_DIR}/matched-scrolled.png` });

    await page.getByRole("button", { name: /Rubedo\. Reserve/ }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Rubedo. Reserve" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Бельбек Рислинг Резерв/ })).toBeVisible();
  });

  test("неуверенный ответ говорит об этом прямо и показывает похожие", async ({ page }) => {
    await stubRecognition(page, RECOGNITIONS.ambiguous);
    await page.goto("/");
    await takeLabelPhoto(page);

    await expect(page.getByText(/^Не уверены — похоже на это вино \(52 %\)/)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Похожие вина" })).toBeVisible();
    await page.screenshot({ path: `${SCREENSHOTS_DIR}/ambiguous.png`, fullPage: true });
  });

  test("нечитаемая этикетка предлагает переснять", async ({ page }) => {
    await stubRecognition(page, RECOGNITIONS.unreadable);
    await page.goto("/");
    await takeLabelPhoto(page);

    await expect(page.getByRole("heading", { name: "Не удалось прочитать этикетку" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Переснять" })).toBeVisible();
    await page.screenshot({ path: `${SCREENSHOTS_DIR}/unreadable.png` });
  });

  test("ошибка API: сообщение сервера, номер запроса и повтор того же фото", async ({ page }) => {
    let attempts = 0;
    await page.route(RECOGNITIONS_ROUTE, (route) => {
      attempts += 1;
      return attempts === 1
        ? route.fulfill({
            status: 503,
            contentType: "application/json",
            body: JSON.stringify({
              error: { code: "RECOGNIZER_UNAVAILABLE", message: "Распознавание сейчас недоступно. Попробуйте через минуту.", requestId: "req-503" },
            }),
          })
        : route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(RECOGNITIONS.matched) });
    });
    await page.goto("/");
    await takeLabelPhoto(page);

    await expect(page.getByText("Распознавание сейчас недоступно. Попробуйте через минуту.")).toBeVisible();
    await expect(page.getByText("Номер запроса для поддержки: req-503")).toBeVisible();
    await page.screenshot({ path: `${SCREENSHOTS_DIR}/error.png` });

    await page.getByRole("button", { name: "Попробовать ещё раз" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Бельбек Рислинг Резерв" })).toBeVisible();
    expect(attempts).toBe(2);
  });

  test("«назад» с результата возвращает к съёмке, а не уводит со страницы", async ({ page }) => {
    await stubRecognition(page, RECOGNITIONS.matched);
    await page.goto("/");
    await takeLabelPhoto(page);
    await expect(page.getByRole("heading", { level: 1, name: "Бельбек Рислинг Резерв" })).toBeVisible();

    await page.goBack();
    await expect(page.getByRole("heading", { name: "Узнайте вино по этикетке" })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/");
  });

  test("тёмная тема: тёмная бумага и перекрашенные фирменные картинки", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/");

    await expect(page.locator("body")).toHaveCSS("background-color", PAPER_DARK);
    // Видимыми остаются только перекрашенные логотип и иллюстрация: светлые на тёмном не читаются.
    const themedArt = page.getByRole("img", { name: /Своё Вино|Этикетка в кадре/ });
    await expect(themedArt).toHaveCount(2);
    for (const art of await themedArt.all()) {
      expect(await art.evaluate((image: HTMLImageElement) => image.currentSrc)).toContain("-dark.svg");
    }
    await page.screenshot({ path: `${SCREENSHOTS_DIR}/capture-dark.png`, fullPage: true });
  });

  test("переключатель темы: ручной выбор побеждает системный и переживает перезагрузку", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/");

    const toggle = page.getByRole("button", { name: /^Тема:/ });
    const scannerArt = page.getByRole("img", { name: "Этикетка в кадре целиком" });
    // Тегов theme-color в рантайме больше одного — цвет рамки верен, только если покрашены все.
    const themeColors = () => page.locator('meta[name="theme-color"]').evaluateAll((metas) => metas.map((meta) => meta.getAttribute("content")));
    await expect(toggle).toHaveAccessibleName(/^Тема: авто/);

    await toggle.click();
    await expect(page.locator("body")).toHaveCSS("background-color", PAPER_LIGHT);
    expect(new Set(await themeColors())).toEqual(new Set(["#FEFDFA"]));
    expect(await scannerArt.evaluate((image: HTMLImageElement) => image.currentSrc)).toContain("/brand/scanner.svg");
    await page.screenshot({ path: `${SCREENSHOTS_DIR}/capture-light-forced.png`, fullPage: true });

    // Выбор лежит в localStorage — после перезагрузки светлая тема остаётся при системной тёмной.
    await page.reload();
    await expect(page.locator("body")).toHaveCSS("background-color", PAPER_LIGHT);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

    await toggle.click();
    await expect(page.locator("body")).toHaveCSS("background-color", PAPER_DARK);
    expect(new Set(await themeColors())).toEqual(new Set(["#1A1614"]));

    // Круг замкнулся: снова «авто» — тема опять идёт за системной.
    await toggle.click();
    await expect(toggle).toHaveAccessibleName(/^Тема: авто/);
    await expect(page.locator("body")).toHaveCSS("background-color", PAPER_DARK);
    await page.emulateMedia({ colorScheme: "light" });
    await expect(page.locator("body")).toHaveCSS("background-color", PAPER_LIGHT);
  });

  test("PWA: манифест с иконками и зарегистрированный service worker", async ({ page, request }) => {
    const manifest = await (await request.get("/manifest.webmanifest")).json();
    expect(manifest).toMatchObject({ short_name: "winvino", display: "standalone", start_url: "/" });
    for (const icon of manifest.icons as Array<{ src: string }>) {
      expect((await request.get(icon.src)).status(), icon.src).toBe(200);
    }

    await page.goto("/");
    const activeWorker = await page.evaluate(async () => (await navigator.serviceWorker.ready).active?.scriptURL ?? null);
    expect(activeWorker).toMatch(/\/sw\.js$/);
  });
});

test.describe("Telegram Mini App", () => {
  const themeParams = {
    bg_color: "#17212b",
    text_color: "#f5f5f5",
    hint_color: "#708499",
    link_color: "#6ab3f3",
    button_color: "#5288c1",
    button_text_color: "#ffffff",
    secondary_bg_color: "#232e3c",
  };
  const launchHash = new URLSearchParams({
    tgWebAppData: "query_id=AAE&user=%7B%22id%22%3A1%7D&auth_date=1790000000&hash=e2e",
    tgWebAppVersion: "8.0",
    tgWebAppPlatform: "tdesktop",
    tgWebAppThemeParams: JSON.stringify(themeParams),
  }).toString();

  test("держит фирменную палитру, а «Сканировать ещё» отдаёт нативной MainButton", async ({ page }) => {
    await stubRecognition(page, RECOGNITIONS.matched);
    await page.goto(`/#${launchHash}`);

    await expect(page.locator("html")).toHaveAttribute("data-telegram", "tdesktop");
    // Тёмная тема клиента на цвета не влияет: внутри Telegram та же бумага vino-svoe.ru, что и в вебе.
    await expect(page.locator("body")).toHaveCSS("background-color", "rgb(254, 253, 250)");

    await takeLabelPhoto(page);
    await expect(page.getByRole("heading", { level: 1, name: "Бельбек Рислинг Резерв" })).toBeVisible();
    await expect
      .poll(() => page.getByRole("img", { name: /^Бутылка/ }).evaluate((image: HTMLImageElement) => image.naturalWidth), { timeout: 15_000 })
      .toBeGreaterThan(0);
    await page.screenshot({ path: `${SCREENSHOTS_DIR}/telegram-matched.png` });

    const telegramButtons = await page.evaluate(() => ({
      mainText: window.Telegram?.WebApp?.MainButton && (window.Telegram.WebApp.MainButton as unknown as { text: string }).text,
      mainVisible: (window.Telegram?.WebApp?.MainButton as unknown as { isVisible: boolean } | undefined)?.isVisible,
      backVisible: (window.Telegram?.WebApp?.BackButton as unknown as { isVisible: boolean } | undefined)?.isVisible,
    }));
    expect(telegramButtons).toEqual({ mainText: "Сканировать ещё", mainVisible: true, backVisible: true });
    await expect(page.getByRole("button", { name: "Сканировать ещё" })).toHaveCount(0);

    const serviceWorkers = await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length);
    expect(serviceWorkers).toBe(0);
  });
});
