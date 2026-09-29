/**
 * Telegram Mini App: минимальные типы используемой части WebApp API и условная загрузка SDK.
 * Справочник: https://core.telegram.org/bots/webapps
 */
import { BRAND_COLORS } from "../app/brand";
import type { ResolvedTheme } from "./theme";

export const TELEGRAM_WEB_APP_SCRIPT_URL = "https://telegram.org/js/telegram-web-app.js?63";

/** Telegram открывает мини-апп с параметрами запуска в hash: #tgWebAppData=…&tgWebAppPlatform=… */
const TELEGRAM_LAUNCH_HASH_PATTERN = /(?:^#|&)tgWebApp(?:Data|Platform|Version)=/;

/** Флаг запуска из Telegram переживает перезагрузку страницы, даже если hash потерялся. */
const TELEGRAM_LAUNCH_STORAGE_KEY = "winvino.telegramLaunch";

type TelegramBottomButtonParams = {
  text?: string;
  is_visible?: boolean;
  is_active?: boolean;
  has_shine_effect?: boolean;
};

export type TelegramBottomButton = {
  setParams(params: TelegramBottomButtonParams): TelegramBottomButton;
  onClick(callback: () => void): TelegramBottomButton;
  offClick(callback: () => void): TelegramBottomButton;
};

export type TelegramBackButton = {
  show(): TelegramBackButton;
  hide(): TelegramBackButton;
  onClick(callback: () => void): TelegramBackButton;
  offClick(callback: () => void): TelegramBackButton;
};

export type TelegramWebApp = {
  initData: string;
  platform: string;
  version: string;
  isVersionAtLeast(version: string): boolean;
  ready(): void;
  expand(): void;
  disableVerticalSwipes(): void;
  setHeaderColor(color: "bg_color" | "secondary_bg_color" | `#${string}`): void;
  setBackgroundColor(color: "bg_color" | "secondary_bg_color" | `#${string}`): void;
  openLink(url: string): void;
  MainButton: TelegramBottomButton;
  BackButton: TelegramBackButton;
  HapticFeedback: {
    notificationOccurred(type: "error" | "success" | "warning"): void;
    impactOccurred(style: "light" | "medium" | "heavy" | "rigid" | "soft"): void;
  };
};

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

export function isTelegramLaunchHash(hash: string): boolean {
  return TELEGRAM_LAUNCH_HASH_PATTERN.test(hash);
}

function detectTelegramLaunch(): boolean {
  if (isTelegramLaunchHash(window.location.hash)) {
    window.sessionStorage.setItem(TELEGRAM_LAUNCH_STORAGE_KEY, "1");
    return true;
  }
  return window.sessionStorage.getItem(TELEGRAM_LAUNCH_STORAGE_KEY) === "1";
}

function injectScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`не загрузился ${src}`));
    document.head.appendChild(script);
  });
}

/**
 * SDK грузится только при запуске из Telegram: в PWA он не нужен, а telegram.org
 * бывает недоступен — не хотим, чтобы из-за этого тормозило приложение вне Telegram.
 * null — открыто не в Telegram или SDK не загрузился (тогда работаем как обычный веб).
 */
export async function loadTelegramWebApp(): Promise<TelegramWebApp | null> {
  if (!detectTelegramLaunch()) return null;
  if (!window.Telegram?.WebApp) {
    try {
      await injectScript(TELEGRAM_WEB_APP_SCRIPT_URL);
    } catch (error) {
      console.warn("Telegram WebApp SDK недоступен, работаем как обычный веб", error);
      return null;
    }
  }
  return window.Telegram?.WebApp ?? null;
}

/** Первичная настройка окна мини-аппа. Методы новее базовой версии — только если клиент их знает. */
export function prepareTelegramWindow(webApp: TelegramWebApp): void {
  document.documentElement.dataset.telegram = webApp.platform;
  // Длинная карточка вина скроллится, и свайп вниз не должен закрывать приложение.
  if (webApp.isVersionAtLeast("7.7")) webApp.disableVerticalSwipes();
  webApp.expand();
  webApp.ready();
}

/**
 * Цвет окна мини-аппа — фирменный и по выбранной в приложении теме, а не из темы клиента:
 * внутри Telegram приложение выглядит так же, как в браузере, и переключатель работает там же.
 */
export function applyTelegramWindowColor(webApp: TelegramWebApp, theme: ResolvedTheme): void {
  if (!webApp.isVersionAtLeast("6.1")) return;
  const windowColor = theme === "dark" ? BRAND_COLORS.paperDark : BRAND_COLORS.paper;
  webApp.setHeaderColor(windowColor);
  webApp.setBackgroundColor(windowColor);
}
