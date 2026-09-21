"use client";

import type { Recognition } from "@winvino/contract";
import { useCallback, useEffect, useRef, useState } from "react";
import { toDisplayError, winvinoClient, type DisplayError } from "@/lib/apiClient";
import { prepareLabelPhoto } from "@/lib/prepareLabelPhoto";
import { registerServiceWorker, useInstallOption } from "@/lib/pwa";
import { loadTelegramWebApp, prepareTelegramWindow, type TelegramWebApp } from "@/lib/telegram";
import { useTelegramBackButton, useTelegramMainButton } from "@/lib/useTelegramButtons";
import { CaptureScreen } from "./CaptureScreen";
import { FailureScreen } from "./FailureScreen";
import { usePhotoPicker } from "./PhotoPicker";
import { ProcessingScreen } from "./ProcessingScreen";
import { RecognitionScreen } from "./RecognitionScreen";

type ScanState =
  | { kind: "idle" }
  | { kind: "processing"; previewUrl: string }
  | { kind: "result"; previewUrl: string; recognition: Recognition }
  | { kind: "failed"; previewUrl: string; photo: Blob; error: DisplayError };

/** Где запущены: до загрузки SDK неизвестно, поэтому три состояния, а не boolean. */
type HostPlatform = { kind: "detecting" } | { kind: "telegram"; webApp: TelegramWebApp } | { kind: "web" };

const RESCAN_LABEL = "Сканировать ещё";

/** Метка своей записи в истории: «назад» с экрана результата возвращает к съёмке, а не закрывает PWA. */
const SCAN_HISTORY_STATE = { winvinoScan: true } as const;

export function ScannerApp() {
  const [scan, setScan] = useState<ScanState>({ kind: "idle" });
  const [host, setHost] = useState<HostPlatform>({ kind: "detecting" });
  const activeRequest = useRef<AbortController | null>(null);
  const previewUrlRef = useRef<string | null>(null);

  const telegram = host.kind === "telegram" ? host.webApp : null;
  const installOption = useInstallOption(host.kind === "web");

  useEffect(() => {
    let isMounted = true;
    void loadTelegramWebApp().then((webApp) => {
      if (!isMounted) return;
      if (webApp) {
        prepareTelegramWindow(webApp);
        setHost({ kind: "telegram", webApp });
      } else {
        registerServiceWorker();
        setHost({ kind: "web" });
      }
    });
    return () => {
      isMounted = false;
    };
  }, []);

  const replacePreviewUrl = useCallback((nextUrl: string | null) => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = nextUrl;
  }, []);

  const resetToIdle = useCallback(() => {
    activeRequest.current?.abort();
    activeRequest.current = null;
    replacePreviewUrl(null);
    setScan({ kind: "idle" });
  }, [replacePreviewUrl]);

  useEffect(() => {
    window.addEventListener("popstate", resetToIdle);
    return () => window.removeEventListener("popstate", resetToIdle);
  }, [resetToIdle]);

  /** Все пути назад (кнопка, жест, BackButton Telegram) идут через историю — поведение одно. */
  const goBackToCapture = useCallback(() => {
    if (window.history.state?.winvinoScan) window.history.back();
    else resetToIdle();
  }, [resetToIdle]);

  const recognizePhoto = useCallback(
    async (photo: Blob, previewUrl: string) => {
      activeRequest.current?.abort();
      const request = new AbortController();
      activeRequest.current = request;
      setScan({ kind: "processing", previewUrl });

      try {
        const recognition = await winvinoClient.recognizeLabel(photo, { signal: request.signal });
        if (request.signal.aborted) return;
        setScan({ kind: "result", previewUrl, recognition });
        telegram?.HapticFeedback.notificationOccurred(recognition.status === "matched" ? "success" : "warning");
      } catch (error) {
        if (request.signal.aborted) return;
        setScan({ kind: "failed", previewUrl, photo, error: toDisplayError(error) });
        telegram?.HapticFeedback.notificationOccurred("error");
      }
    },
    [telegram],
  );

  const handlePhotoPicked = useCallback(
    async (file: File) => {
      if (!window.history.state?.winvinoScan) window.history.pushState(SCAN_HISTORY_STATE, "");
      // Превью — сразу из оригинала, ужатие идёт уже на экране распознавания.
      const previewUrl = URL.createObjectURL(file);
      replacePreviewUrl(previewUrl);
      setScan({ kind: "processing", previewUrl });
      const photo = await prepareLabelPhoto(file);
      // Пока ужимали, могли нажать «назад» или выбрать другое фото — тогда этот снимок уже не нужен.
      if (previewUrlRef.current !== previewUrl) return;
      await recognizePhoto(photo, previewUrl);
    },
    [recognizePhoto, replacePreviewUrl],
  );

  const photoPicker = usePhotoPicker(handlePhotoPicked);

  const openExternalLink = useCallback(
    (url: string) => {
      if (telegram) telegram.openLink(url);
      else window.open(url, "_blank", "noopener,noreferrer");
    },
    [telegram],
  );

  // Файловый диалог нельзя открыть из MainButton — это не жест пользователя в веб-вью.
  // Поэтому нативная кнопка только возвращает к съёмке, а снимать — кнопкой на странице.
  const isShowingOutcome = scan.kind === "result" || scan.kind === "failed";
  useTelegramMainButton(telegram, isShowingOutcome ? { text: RESCAN_LABEL, onClick: goBackToCapture } : null);
  useTelegramBackButton(telegram, scan.kind === "idle" ? null : goBackToCapture);

  const isTelegram = telegram !== null;

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-5">
      {photoPicker.inputs}
      {scan.kind === "idle" && (
        <CaptureScreen onTakePhoto={photoPicker.openCamera} onChooseFromGallery={photoPicker.openGallery} installOption={installOption} />
      )}
      {scan.kind === "processing" && <ProcessingScreen previewUrl={scan.previewUrl} />}
      {scan.kind === "result" && (
        <RecognitionScreen
          key={scan.recognition.id}
          recognition={scan.recognition}
          previewUrl={scan.previewUrl}
          onRetake={photoPicker.openCamera}
          onBackToCapture={isTelegram ? null : goBackToCapture}
          backToCaptureLabel={RESCAN_LABEL}
          onOpenLink={openExternalLink}
        />
      )}
      {scan.kind === "failed" && (
        <FailureScreen
          error={scan.error}
          previewUrl={scan.previewUrl}
          onRetry={() => void recognizePhoto(scan.photo, scan.previewUrl)}
          onRetake={photoPicker.openCamera}
        />
      )}
    </div>
  );
}
