"use client";

import { useEffect, useEffectEvent } from "react";
import type { TelegramWebApp } from "./telegram";

/** Нативная кнопка Telegram внизу экрана. null — спрятать. Вне Telegram (webApp = null) ничего не делает. */
export function useTelegramMainButton(
  webApp: TelegramWebApp | null,
  button: { text: string; onClick: () => void } | null,
): void {
  const text = button?.text ?? null;
  const handleMainButtonClick = useEffectEvent(() => button?.onClick());

  useEffect(() => {
    if (!webApp) return;
    if (text === null) {
      webApp.MainButton.setParams({ is_visible: false });
      return;
    }
    const listener = () => handleMainButtonClick();
    webApp.MainButton.setParams({ text, is_visible: true, is_active: true }).onClick(listener);
    return () => {
      webApp.MainButton.offClick(listener);
    };
  }, [webApp, text]);
}

/** Кнопка «назад» в шапке Telegram. */
export function useTelegramBackButton(webApp: TelegramWebApp | null, onBack: (() => void) | null): void {
  const isVisible = onBack !== null;
  const handleBackButtonClick = useEffectEvent(() => onBack?.());

  useEffect(() => {
    if (!webApp || !webApp.isVersionAtLeast("6.1")) return;
    if (!isVisible) {
      webApp.BackButton.hide();
      return;
    }
    const listener = () => handleBackButtonClick();
    webApp.BackButton.show().onClick(listener);
    return () => {
      webApp.BackButton.offClick(listener);
    };
  }, [webApp, isVisible]);
}
