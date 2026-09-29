"use client";

import { nextThemePreference, setThemePreference, type ThemePreference } from "@/lib/theme";
import { useTheme } from "@/lib/useTheme";

const THEME_LABELS: Record<ThemePreference, { name: string; switchTo: string }> = {
  auto: { name: "авто, как на устройстве", switchTo: "авто" },
  light: { name: "светлая", switchTo: "светлую" },
  dark: { name: "тёмная", switchTo: "тёмную" },
};

/** Иконки в стиле lucide (как на сайте): 24×24, обводка currentColor. */
function ThemeIcon({ preference }: { preference: ThemePreference }) {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      {preference === "light" && (
        <>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
        </>
      )}
      {preference === "dark" && <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" strokeLinejoin="round" />}
      {preference === "auto" && (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 21a9 9 0 0 0 0-18Z" fill="currentColor" strokeLinejoin="round" />
        </>
      )}
    </svg>
  );
}

export function ThemeToggle() {
  const { preference } = useTheme();
  const next = nextThemePreference(preference);

  return (
    <button
      type="button"
      onClick={() => setThemePreference(next)}
      aria-label={`Тема: ${THEME_LABELS[preference].name}. Переключить на ${THEME_LABELS[next].switchTo}`}
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink transition-[background-color,transform] duration-200 hover:bg-action-soft active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action"
    >
      <ThemeIcon preference={preference} />
    </button>
  );
}
