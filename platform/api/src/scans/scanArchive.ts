import { createHash } from 'node:crypto';
import type { AcceptedImageType } from '@winvino/contract';
import { IMAGE_EXTENSION } from '../image/inspectImage.ts';
import type { RecognitionOutcome } from '../recognizer/recognizer.ts';

/**
 * Прод-сканы лежат в той же таблице label_scans, что и eval-набор, и отличаются от него
 * значением source: вьюха label_scan_accuracy считает метрики только по eval_set, поэтому
 * поток с продакшна её не искажает. Эталон (truth_wine_slug/truth_absent) у такой строки
 * пустой — его проставляет человек в админке, и после этого скан идёт в дообучение.
 */
export const PRODUCTION_SCAN_SOURCE = 'production';

/** Что случилось с одним запросом распознавания. */
export type ScanRecord = {
  /** Тот же id, что ушёл клиенту: по нему скан находят в логах и в админке. */
  id: string;
  imageBytes: Uint8Array;
  imageMimeType: AcceptedImageType;
  outcome: RecognitionOutcome;
  processingMs: number;
  /** Имя распознавателя, ответившего на этот кадр (mock | model). */
  recognizer: string;
};

/**
 * Разбор предсказания в jsonb. Колонок под статус и причину отказа в таблице нет, а без них
 * непонятно, показали ли пользователю карточку (matched/ambiguous) или отказ и какой.
 */
export type ScanCandidates = {
  status: RecognitionOutcome['status'];
  reason: string | null;
  /** Лидер и альтернативы по убыванию уверенности; пусто при отказе. */
  top: { slug: string; confidence: number }[];
  processingMs: number;
  recognizer: string;
};

/** Строка label_scans ровно в тех полях, которые заполняет прод. */
export type ScanRow = {
  id: string;
  source: string;
  imagePath: string;
  imageSha256: string;
  predictedWineSlug: string | null;
  predictedScore: number | null;
  candidates: ScanCandidates;
  matcherVersion: string;
};

export type ScanStore = (relativePath: string, bytes: Uint8Array) => Promise<void>;
export type ScanInsert = (row: ScanRow) => Promise<void>;

export type ScanArchive = {
  /** Никогда не отклоняется: сбой архива — это запись в лог, а не ошибка клиенту. */
  save(record: ScanRecord): Promise<void>;
};

/**
 * Имя файла — от содержимого, поэтому один и тот же кадр занимает место один раз.
 * Первые два символа хеша уходят в подкаталог: иначе в одной папке копятся сотни тысяч файлов.
 * Разделитель всегда `/` — пути сравниваются с записями офлайн-скриптов (см. миграцию
 * 20260914112834, где пути с обратными слешами пришлось нормализовать задним числом).
 */
export function scanImagePath(sha256: string, mimeType: AcceptedImageType): string {
  return `${PRODUCTION_SCAN_SOURCE}/${sha256.slice(0, 2)}/${sha256}.${IMAGE_EXTENSION[mimeType]}`;
}

export function scanRow(record: ScanRecord, matcherVersion: string): ScanRow {
  const sha256 = createHash('sha256').update(record.imageBytes).digest('hex');
  const { outcome } = record;
  const top = (outcome.match ? [outcome.match, ...outcome.alternatives] : []).map((candidate) => ({
    slug: candidate.wine.slug,
    confidence: candidate.confidence,
  }));
  return {
    id: record.id,
    source: PRODUCTION_SCAN_SOURCE,
    imagePath: scanImagePath(sha256, record.imageMimeType),
    imageSha256: sha256,
    predictedWineSlug: outcome.match?.wine.slug ?? null,
    predictedScore: outcome.match?.confidence ?? null,
    candidates: {
      status: outcome.status,
      reason: outcome.reason,
      top,
      processingMs: record.processingMs,
      recognizer: record.recognizer,
    },
    matcherVersion,
  };
}

/**
 * Архив пишет мимо ответа клиенту: распознавание уже отдано, и ни отказ диска, ни лежащая
 * база не должны превращаться в ошибку у пользователя — только в строку лога.
 * Фото пишется первым: строка с image_path на несуществующий файл бесполезна и для админки,
 * и для дообучения, поэтому при сбое записи файла строка не заводится.
 */
export function createScanArchive(deps: {
  store: ScanStore;
  insert: ScanInsert;
  matcherVersion: string;
  log?: Pick<Console, 'error'>;
}): ScanArchive {
  const { store, insert, matcherVersion, log = console } = deps;
  const report = (event: string, row: ScanRow, error: unknown) =>
    log.error(JSON.stringify({ event, scanId: row.id, imagePath: row.imagePath, message: (error as Error).message }));

  return {
    async save(record) {
      const row = scanRow(record, matcherVersion);
      try {
        await store(row.imagePath, record.imageBytes);
      } catch (error) {
        return report('scan_image_save_failed', row, error);
      }
      try {
        await insert(row);
      } catch (error) {
        report('scan_row_save_failed', row, error);
      }
    },
  };
}
