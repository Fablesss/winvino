import { describe, expect, it } from "vitest";
import { nextThemePreference, THEME_INIT_SCRIPT } from "./theme";

describe("nextThemePreference", () => {
  it("cyclesAutoLightDarkAndBack", () => {
    expect(nextThemePreference("auto")).toBe("light");
    expect(nextThemePreference("light")).toBe("dark");
    expect(nextThemePreference("dark")).toBe("auto");
  });
});

describe("THEME_INIT_SCRIPT", () => {
  // Скрипт выполняется до отрисовки: любая его ошибка — вспышка чужой темы на весь экран.
  it("survivesBlockedStorage", () => {
    const documentElement = { dataset: {} as Record<string, string> };
    const globals = {
      localStorage: {
        getItem() {
          throw new Error("доступ к хранилищу запрещён");
        },
      },
      matchMedia: () => ({ matches: true }),
      document: { documentElement, querySelectorAll: () => [] },
    };

    expect(() => new Function(...Object.keys(globals), THEME_INIT_SCRIPT)(...Object.values(globals))).not.toThrow();
    expect(documentElement.dataset.theme).toBeUndefined();
  });

  it("prefersStoredChoiceOverSystem", () => {
    const documentElement = { dataset: {} as Record<string, string> };
    const themeColor: string[] = [];
    const globals = {
      localStorage: { getItem: () => "light" },
      matchMedia: () => ({ matches: true }),
      // Тегов theme-color в рантайме два — красить нужно оба.
      document: {
        documentElement,
        querySelectorAll: () => [0, 1].map(() => ({ setAttribute: (...args: string[]) => themeColor.push(args[1] ?? "") })),
      },
    };

    new Function(...Object.keys(globals), THEME_INIT_SCRIPT)(...Object.values(globals));

    expect(documentElement.dataset.theme).toBe("light");
    expect(themeColor).toEqual(["#FEFDFA", "#FEFDFA"]);
  });
});
