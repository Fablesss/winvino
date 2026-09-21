import sharp from 'sharp';

/**
 * Фото бутылки из каталога нельзя отдать Telegram ссылкой: ресайзер каталога отвечает WebP
 * с прозрачным фоном и Content-Type application/octet-stream, а sendPhoto по URL требует
 * верный MIME. Поэтому бот скачивает картинку сам и загружает её JPEG-ом.
 */

/** Цвет бумаги веба (web/app/brand.ts, BRAND_COLORS.paper) — под прозрачный фон бутылки. */
const BOTTLE_BACKGROUND = '#F1F3EF';
/** Бутылка в каталоге ~1:4 — в чате это тонкая полоска. Дополняем фоном до 3:4. */
const BOTTLE_CANVAS_WIDTH_TO_HEIGHT = 3 / 4;
const BOTTLE_JPEG_QUALITY = 85;
const BOTTLE_FETCH_TIMEOUT_MS = 10_000;

/** Картинка без прозрачности, по центру холста 3:4, в JPEG. */
export async function convertBottleToChatJpeg(source: Uint8Array): Promise<Uint8Array> {
  const { width, height } = await sharp(source).metadata();
  const canvasWidth = Math.max(width, Math.round(height * BOTTLE_CANVAS_WIDTH_TO_HEIGHT));
  const padLeft = Math.floor((canvasWidth - width) / 2);
  return sharp(source)
    .flatten({ background: BOTTLE_BACKGROUND })
    .extend({ left: padLeft, right: canvasWidth - width - padLeft, background: BOTTLE_BACKGROUND })
    .jpeg({ quality: BOTTLE_JPEG_QUALITY })
    .toBuffer();
}

export async function fetchBottlePhotoJpeg(url: string, fetchImpl: typeof fetch = globalThis.fetch): Promise<Blob> {
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(BOTTLE_FETCH_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`фото бутылки не скачалось: HTTP ${response.status}, ${url}`);
  const jpeg = await convertBottleToChatJpeg(new Uint8Array(await response.arrayBuffer()));
  return new Blob([jpeg], { type: 'image/jpeg' });
}
