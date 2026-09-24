import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import type { ScanInsert, ScanRow, ScanStore } from './scanArchive.ts';

/**
 * Фото на локальный диск (в деплое — том, смонтированный в SCAN_ARCHIVE_DIR).
 * Флаг `wx` делает запись дедупликацией: имя файла — хеш содержимого, значит существующий
 * файл уже тот самый, и переписывать его нечем.
 */
export function createFileScanStore(dir: string): ScanStore {
  return async (relativePath, bytes) => {
    const target = path.join(dir, relativePath);
    await mkdir(path.dirname(target), { recursive: true });
    try {
      await writeFile(target, bytes, { flag: 'wx' });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  };
}

/**
 * Эталон (truth_wine_slug) и ocr_provider у прод-строки пустые, поэтому уникальный индекс
 * label_scans_source_image_truth_provider_key на них не срабатывает: каждый запрос — своя
 * строка, даже если кадр прислали повторно. Так и надо — id строки уже отдан клиенту, и в
 * статистике важно, сколько раз вино сканировали.
 */
const INSERT_SCAN_SQL = `
INSERT INTO label_scans (id, source, image_path, image_sha256, predicted_wine_slug, predicted_score,
                         candidates, matcher_version, matched_at)
VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, now())`;

export type ScanWriter = { insert: ScanInsert; close: () => Promise<void> };

export function createPgScanWriter(databaseUrl: string): ScanWriter {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 2, connectionTimeoutMillis: 15_000, idleTimeoutMillis: 10_000 });
  return {
    insert: async (row: ScanRow) => {
      await pool.query(INSERT_SCAN_SQL, [
        row.id,
        row.source,
        row.imagePath,
        row.imageSha256,
        row.predictedWineSlug,
        row.predictedScore,
        JSON.stringify(row.candidates),
        row.matcherVersion,
      ]);
    },
    close: () => pool.end(),
  };
}
