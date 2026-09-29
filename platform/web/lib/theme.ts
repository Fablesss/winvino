/**
 * Тема приложения: «авто» (как на устройстве) плюс ручной выбор, который переживает перезагрузку.
 * Источник правды — localStorage; в документ тема попадает атрибутом `data-theme` на <html>,
 * от него же зависят и палитра в globals.css, и выбор перекрашенных картинок.
 */
import { BRAND_COLORS } from "../app/brand";

export const THEME_PREFERENCES = ["auto", "light", "dark"] as const;

export type ThemePreference = (typeof THEME_PREFERENCES)[number];
export type ResolvedTheme = "light" | "dark";
export type ThemeState = { preference: ThemePreference; resolved: ResolvedTheme };

const STORAGE_KEY = "winvino.theme";
const DARK_QUERY = "(prefers-color-scheme: dark)";

/**
 * До гидратации тема неизвестна: на сервере нет ни localStorage, ни системной настройки.
 * Разметка от неё не зависит — цвета берёт CSS по атрибуту, который уже поставил THEME_INIT_SCRIPT.
 */
const INITIAL_STATE: ThemeState = { preference: "auto", resolved: "light" };

let state: ThemeState = INITIAL_STATE;
const listeners = new Set<() => void>();

function isThemePreference(value: string | null): value is ThemePreference {
  return value !== null && (THEME_PREFERENCES as readonly string[]).includes(value);
}

/** Приватный режим и заблокированные куки роняют доступ к localStorage — тогда просто «авто». */
function readStoredPreference(): ThemePreference {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return isThemePreference(stored) ? stored : "auto";
  } catch {
    return "auto";
  }
}

function resolvePreference(preference: ThemePreference): ResolvedTheme {
  if (preference !== "auto") return preference;
  return window.matchMedia(DARK_QUERY).matches ? "dark" : "light";
}

/**
 * Единственное место, где тема попадает в документ: атрибут для CSS и цвет системной рамки.
 * Тегов theme-color в рантайме больше одного (Next отдаёт свой, React поднимает копию из
 * гидратации) — правим все, иначе цвет рамки зависит от того, какой из них попался первым.
 */
function applyToDocument(resolved: ResolvedTheme): void {
  document.documentElement.dataset.theme = resolved;
  const color = resolved === "dark" ? BRAND_COLORS.paperDark : BRAND_COLORS.paper;
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) meta.setAttribute("content", color);
}

function publish(preference: ThemePreference): void {
  const resolved = resolvePreference(preference);
  if (state.preference === preference && state.resolved === resolved) return;
  state = { preference, resolved };
  applyToDocument(resolved);
  for (const listener of listeners) listener();
}

function handleSystemChange(): void {
  publish(state.preference);
}

/** Хранилище для useSyncExternalStore: подписка, снимок и снимок «до гидратации» (lib/useTheme.ts). */
export function subscribeToTheme(listener: () => void): () => void {
  if (listeners.size === 0) {
    window.matchMedia(DARK_QUERY).addEventListener("change", handleSystemChange);
    // Первый подписчик появляется после гидратации — здесь и забираем сохранённый выбор.
    publish(readStoredPreference());
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.matchMedia(DARK_QUERY).removeEventListener("change", handleSystemChange);
  };
}

export function getThemeState(): ThemeState {
  return state;
}

export function getInitialThemeState(): ThemeState {
  return INITIAL_STATE;
}

export function setThemePreference(preference: ThemePreference): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, preference);
  } catch {
    // Выбор не переживёт перезагрузку, но в этой сессии тема всё равно сменится.
  }
  publish(preference);
}

export function nextThemePreference(current: ThemePreference): ThemePreference {
  const next = THEME_PREFERENCES[(THEME_PREFERENCES.indexOf(current) + 1) % THEME_PREFERENCES.length];
  return next ?? "auto";
}

/**
 * Идёт в <body> первой строкой и выставляет тему до первой отрисовки: иначе в тёмной теме
 * мелькает кадр светлой. Логика повторяет readStoredPreference/resolvePreference — модуль
 * к этому моменту ещё не загружен, а ждать его значит показать вспышку.
 */
export const THEME_INIT_SCRIPT = [
  "try{",
  `var p=localStorage.getItem(${JSON.stringify(STORAGE_KEY)});`,
  `var d=p==="dark"||(p!=="light"&&matchMedia(${JSON.stringify(DARK_QUERY)}).matches);`,
  'document.documentElement.dataset.theme=d?"dark":"light";',
  `var c=d?${JSON.stringify(BRAND_COLORS.paperDark)}:${JSON.stringify(BRAND_COLORS.paper)};`,
  "var m=document.querySelectorAll('meta[name=\"theme-color\"]');",
  'for(var i=0;i<m.length;i++)m[i].setAttribute("content",c);',
  "}catch(e){}",
].join("");
