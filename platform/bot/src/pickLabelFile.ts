import { MAX_IMAGE_BYTES, RECOMMENDED_MAX_IMAGE_SIDE_PX } from '@winvino/contract';
import type { TelegramMessage, TelegramPhotoSize } from './telegram/botApi.ts';

/** Что из сообщения отправлять на распознавание. */
export type LabelFile =
  | { kind: 'file'; fileId: string; filename: string }
  /** Картинка файлом больше лимита API: скачивать её бессмысленно. */
  | { kind: 'too_large' }
  | { kind: 'none' };

/** Telegram перекодирует присланные фото в JPEG. */
const TELEGRAM_PHOTO_FILENAME = 'label.jpg';

/**
 * Telegram хранит фото в нескольких размерах. Берём наибольший, что не длиннее рекомендованного
 * контрактом: больше распознаванию не нужно. Все длиннее — наименьший из них.
 */
export function pickPhotoSize(sizes: readonly TelegramPhotoSize[]): TelegramPhotoSize | undefined {
  const byArea = [...sizes].sort((a, b) => a.width * a.height - b.width * b.height);
  const fitting = byArea.filter((size) => Math.max(size.width, size.height) <= RECOMMENDED_MAX_IMAGE_SIDE_PX);
  return fitting.at(-1) ?? byArea[0];
}

/**
 * Фото или картинка, присланная файлом (так приходит оригинал без сжатия). Формат не проверяем:
 * это делает API и объясняет отказ своим сообщением, например про HEIC.
 */
export function pickLabelFile(message: TelegramMessage): LabelFile {
  const photoSize = pickPhotoSize(message.photo ?? []);
  if (photoSize) return { kind: 'file', fileId: photoSize.file_id, filename: TELEGRAM_PHOTO_FILENAME };

  const document = message.document;
  if (!document?.mime_type?.startsWith('image/')) return { kind: 'none' };
  if ((document.file_size ?? 0) > MAX_IMAGE_BYTES) return { kind: 'too_large' };
  return { kind: 'file', fileId: document.file_id, filename: document.file_name ?? TELEGRAM_PHOTO_FILENAME };
}
