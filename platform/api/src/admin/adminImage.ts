import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { sniffImageType } from '../image/inspectImage.ts';

export type AdminImage = { bytes: Uint8Array; contentType: string };

/** null — файла нет: скан записан, а фото не долежало (том пересоздали, чистили руками). */
export type AdminImageReader = (imagePath: string) => Promise<AdminImage | null>;

/**
 * Читает фото скана из каталога архива. image_path приходит из базы, но проверяется всё равно:
 * строку в label_scans пишет не только API (есть офлайн-скрипты), а `..` в ней превратила бы
 * выдачу фото в чтение любого файла контейнера.
 *
 * Тип отдаётся по сигнатуре файла, а не по расширению — как на приёме (inspectImage.ts).
 */
export function createFileImageReader(scansDir: string): AdminImageReader {
  const root = path.resolve(scansDir);
  return async (imagePath) => {
    const target = path.resolve(root, imagePath);
    if (target !== root && !target.startsWith(root + path.sep)) return null;
    let bytes: Uint8Array;
    try {
      bytes = await readFile(target);
    } catch {
      return null;
    }
    const sniffed = sniffImageType(bytes);
    return { bytes, contentType: sniffed && sniffed !== 'image/heic' ? sniffed : 'application/octet-stream' };
  };
}
