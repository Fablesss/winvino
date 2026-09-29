import { useSyncExternalStore } from "react";
import { getInitialThemeState, getThemeState, subscribeToTheme, type ThemeState } from "./theme";

/**
 * Тема без провайдера: состояние лежит в модуле, поэтому шапка и обёртка мини-аппа
 * видят одно и то же. До гидратации отдаётся снимок по умолчанию — разметка от темы не зависит.
 */
export function useTheme(): ThemeState {
  return useSyncExternalStore(subscribeToTheme, getThemeState, getInitialThemeState);
}
