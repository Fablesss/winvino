import { MIN_IMAGE_SIDE_PX, type AcceptedImageType, type ApiErrorCode } from '@winvino/contract';
import sharp from 'sharp';

export type InspectedImage = {
  bytes: Uint8Array;
  mimeType: AcceptedImageType;
  width: number;
  height: number;
};

export type ImageRejection = {
  code: Extract<ApiErrorCode, 'UNSUPPORTED_IMAGE_TYPE' | 'IMAGE_UNREADABLE' | 'IMAGE_TOO_SMALL'>;
  message?: string;
  details?: Record<string, unknown>;
};

export type ImageInspection = { ok: true; image: InspectedImage } | { ok: false; rejection: ImageRejection };

/** Бренды контейнера ISO BMFF, под которыми iPhone и Android пишут HEIC/HEIF. */
const HEIF_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1']);

const HEIC_MESSAGE = 'Фото в формате HEIC не поддерживается — сохраните его как JPEG и отправьте снова.';

function asciiAt(bytes: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(start, start + length));
}

/** Формат по сигнатуре: Content-Type и расширение клиенты выставляют как попало. */
export function sniffImageType(bytes: Uint8Array): AcceptedImageType | 'image/heic' | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (asciiAt(bytes, 0, 8) === '\x89PNG\r\n\x1a\n') return 'image/png';
  if (asciiAt(bytes, 0, 4) === 'RIFF' && asciiAt(bytes, 8, 4) === 'WEBP') return 'image/webp';
  if (asciiAt(bytes, 4, 4) === 'ftyp' && HEIF_BRANDS.has(asciiAt(bytes, 8, 4))) return 'image/heic';
  return null;
}

/** Проверяет формат и размеры, не декодируя пиксели: sharp читает только заголовок. */
export async function inspectImage(bytes: Uint8Array): Promise<ImageInspection> {
  const sniffedType = sniffImageType(bytes);
  if (sniffedType === 'image/heic') {
    return { ok: false, rejection: { code: 'UNSUPPORTED_IMAGE_TYPE', message: HEIC_MESSAGE, details: { detected: 'image/heic' } } };
  }
  if (sniffedType === null) return { ok: false, rejection: { code: 'UNSUPPORTED_IMAGE_TYPE' } };

  let width: number | undefined;
  let height: number | undefined;
  try {
    ({ width, height } = await sharp(bytes).metadata());
  } catch {
    // Сигнатура верная, а заголовок битый — это ответ клиенту, а не сбой сервера.
    return { ok: false, rejection: { code: 'IMAGE_UNREADABLE' } };
  }
  if (!width || !height) return { ok: false, rejection: { code: 'IMAGE_UNREADABLE' } };

  if (Math.min(width, height) < MIN_IMAGE_SIDE_PX) {
    return {
      ok: false,
      rejection: { code: 'IMAGE_TOO_SMALL', details: { width, height, minSidePx: MIN_IMAGE_SIDE_PX } },
    };
  }
  return { ok: true, image: { bytes, mimeType: sniffedType, width, height } };
}
