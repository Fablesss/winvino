"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

export const SERVICE_WORKER_URL = "/sw.js";

/**
 * В dev service worker мешает горячей перезагрузке, в Telegram — не нужен
 * (там нет установки, а кеш оболочки рискует показать старую версию).
 */
export function registerServiceWorker(): void {
  if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
  navigator.serviceWorker
    .register(SERVICE_WORKER_URL, { scope: "/", updateViaCache: "none" })
    .catch((error: unknown) => console.warn("service worker не зарегистрирован", error));
}

type BeforeInstallPromptEvent = Event & {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

/** prompt — браузер ставит по кнопке (Chrome, Edge); iosHint — только вручную через «Поделиться». */
export type InstallOption = { kind: "none" } | { kind: "prompt"; install: () => Promise<void> } | { kind: "iosHint" };

function isRunningStandalone(): boolean {
  const navigatorWithStandalone = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia("(display-mode: standalone)").matches || navigatorWithStandalone.standalone === true;
}

function isAppleMobile(): boolean {
  // iPadOS притворяется Mac, выдаёт его только сенсорный экран.
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
}

/** Платформа не меняется за время жизни страницы — подписываться не на что. */
const subscribeToNothing = () => () => {};

export function useInstallOption(isEnabled: boolean): InstallOption {
  // На сервере платформа неизвестна (false), в браузере читается сразу после гидратации.
  const shouldShowIosHint = useSyncExternalStore(
    subscribeToNothing,
    () => isEnabled && isAppleMobile() && !isRunningStandalone(),
    () => false,
  );
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    if (!isEnabled) return;
    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
    };
    const handleInstalled = () => setDeferredPrompt(null);
    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleInstalled);
    };
  }, [isEnabled]);

  if (shouldShowIosHint) return { kind: "iosHint" };
  if (deferredPrompt && isEnabled) {
    return {
      kind: "prompt",
      install: async () => {
        await deferredPrompt.prompt();
        await deferredPrompt.userChoice;
        setDeferredPrompt(null);
      },
    };
  }
  return { kind: "none" };
}
