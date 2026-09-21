import { RECOMMENDED_MAX_IMAGE_SIDE_PX } from "@winvino/contract";

const JPEG_QUALITY = 0.86;

/** Итоговые размеры: длинная сторона не больше maxSide, пропорции сохраняются, увеличения нет. */
export function fitWithinSide(width: number, height: number, maxSide: number): { width: number; height: number } {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

/**
 * Ужимает снимок до рекомендованного контрактом размера и перекодирует в JPEG: снимок
 * телефона весит мегабайты, а поворот по EXIF «запекается» в пиксели.
 * Не смогли декодировать (например, HEIC в Chrome) — отдаём оригинал: сервер
 * проверит формат сам и объяснит, что не так.
 */
export async function prepareLabelPhoto(photo: File): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(photo, { imageOrientation: "from-image" });
  } catch {
    return photo;
  }

  const size = fitWithinSide(bitmap.width, bitmap.height, RECOMMENDED_MAX_IMAGE_SIDE_PX);
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext("2d");
  if (!context) {
    bitmap.close();
    return photo;
  }
  context.drawImage(bitmap, 0, 0, size.width, size.height);
  bitmap.close();

  const jpeg = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY));
  return jpeg ?? photo;
}
