"use client";

import { useRef, type ChangeEvent, type ReactNode } from "react";

/** Не сужаем до JPEG/PNG/WebP: с image/* iOS сам отдаёт HEIC как JPEG. Формат всё равно проверит сервер. */
const PHOTO_ACCEPT = "image/*";

type PhotoPicker = {
  openCamera: () => void;
  openGallery: () => void;
  inputs: ReactNode;
};

/**
 * Два скрытых input: с capture сразу открывается камера, без него — галерея.
 * open* вызывать только из обработчика клика: браузеры не открывают диалог без жеста пользователя.
 */
export function usePhotoPicker(onPhotoPicked: (photo: File) => void): PhotoPicker {
  const cameraInput = useRef<HTMLInputElement>(null);
  const galleryInput = useRef<HTMLInputElement>(null);

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const photo = event.target.files?.[0];
    // Сбрасываем, чтобы повторный выбор того же файла снова вызвал change.
    event.target.value = "";
    if (photo) onPhotoPicked(photo);
  };

  return {
    openCamera: () => cameraInput.current?.click(),
    openGallery: () => galleryInput.current?.click(),
    inputs: (
      <>
        <input
          ref={cameraInput}
          type="file"
          accept={PHOTO_ACCEPT}
          capture="environment"
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          data-testid="camera-input"
          onChange={handleChange}
        />
        <input
          ref={galleryInput}
          type="file"
          accept={PHOTO_ACCEPT}
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          data-testid="gallery-input"
          onChange={handleChange}
        />
      </>
    ),
  };
}
