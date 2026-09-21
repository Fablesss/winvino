import sharp from 'sharp';

/** Однотонная картинка; seed меняет цвет, а значит и sha256 — мок отвечает по-разному. */
export async function renderTestImage(
  format: 'jpeg' | 'png' | 'webp',
  { width = 640, height = 480, seed = 0 }: { width?: number; height?: number; seed?: number } = {},
): Promise<Uint8Array> {
  const image = sharp({
    create: { width, height, channels: 3, background: { r: seed % 256, g: (seed * 7) % 256, b: 120 } },
  });
  return new Uint8Array(await image.toFormat(format).toBuffer());
}

/** Заголовок ISO BMFF с брендом heic — так начинаются фото с iPhone. */
export const HEIC_HEADER = new Uint8Array([0, 0, 0, 0x18, ...new TextEncoder().encode('ftypheic'), 0, 0, 0, 0]);

/** Верная сигнатура JPEG, дальше мусор. */
export const CORRUPT_JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Uint8Array(64).fill(0x13)]);
