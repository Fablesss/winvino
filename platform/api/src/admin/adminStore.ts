import type { AdminScan, AdminScanPage, AdminScanQuery, AdminTruthInput, AdminWineOption } from '@winvino/contract';
import pg from 'pg';
import { PRODUCTION_SCAN_SOURCE } from '../scans/scanArchive.ts';
import { adminScanFromRow, scanSlugs, truthRankIn, type AdminScanRow, type WineTitles } from './adminScan.ts';

/** Чем закончилась попытка проставить эталон. Всё, кроме `saved`, — ответ разметчику, а не 500. */
export type AdminTruthResult =
  | { status: 'saved'; scan: AdminScan }
  | { status: 'scan_not_found' }
  | { status: 'no_prediction' }
  | { status: 'unknown_wine' };

export type AdminStore = {
  listScans(query: AdminScanQuery): Promise<AdminScanPage>;
  /** Один скан для экрана разметки; null — скана нет или он не из прода. */
  getScan(scanId: string): Promise<AdminScan | null>;
  setTruth(scanId: string, input: AdminTruthInput): Promise<AdminTruthResult>;
  /** Путь фото внутри каталога сканов; null — скана нет. */
  scanImagePath(scanId: string): Promise<string | null>;
  searchWines(query: string, limit: number): Promise<AdminWineOption[]>;
  close(): Promise<void>;
};

const SCAN_COLUMNS = `id, created_at, image_path, image_sha256, matcher_version, candidates,
       predicted_wine_slug, predicted_score, truth_wine_slug, truth_absent, truth_rank`;

/** Разметка бывает только у прода: eval-набор размечен заранее и в очередь не попадает. */
const PENDING_CONDITION = 'truth_wine_slug IS NULL AND NOT truth_absent';
const TRUTH_CONDITION: Record<AdminScanQuery['filter'], string> = {
  pending: PENDING_CONDITION,
  labeled: `NOT (${PENDING_CONDITION})`,
};

/**
 * Страница берётся по курсору (created_at, id), а не по OFFSET: очередь пополняется прод-сканами
 * прямо во время разметки, и от OFFSET строки бы прыгали между страницами.
 */
const listScansSql = (filter: AdminScanQuery['filter']) => `
SELECT ${SCAN_COLUMNS}
FROM label_scans
WHERE source = $1
  AND ${TRUTH_CONDITION[filter]}
  AND ($2::timestamptz IS NULL OR (created_at, id) < ($2::timestamptz, $3::uuid))
ORDER BY created_at DESC, id DESC
LIMIT $4`;

const PENDING_TOTAL_SQL = `
SELECT count(*)::int AS pending FROM label_scans WHERE source = $1 AND ${PENDING_CONDITION}`;

const WINE_TITLES_SQL = `
SELECT w.slug, w.title, m.name AS manufacturer_name
FROM wines w LEFT JOIN manufacturers m ON m.id = w.manufacturer_id
WHERE w.slug = ANY($1::text[])`;

/**
 * Поиск для «на самом деле это»: по нормализованным колонкам (norm_label), чтобы регистр,
 * ё и дефисы не мешали, а порядок — по триграммному сходству названия. Винодельня в условии
 * тоже есть: разметчик обычно читает с этикетки именно её.
 */
const SEARCH_WINES_SQL = `
WITH needle AS (SELECT public.norm_label($1) AS q)
SELECT w.slug, w.title, m.name AS manufacturer_name
FROM wines w
LEFT JOIN manufacturers m ON m.id = w.manufacturer_id
CROSS JOIN needle
WHERE w.title_norm LIKE '%' || needle.q || '%'
   OR w.slug_norm LIKE '%' || needle.q || '%'
   OR m.name_norm LIKE '%' || needle.q || '%'
ORDER BY greatest(similarity(w.title_norm, needle.q), similarity(coalesce(m.name_norm, ''), needle.q)) DESC,
         w.title
LIMIT $2`;

const SELECT_SCAN_SQL = `SELECT ${SCAN_COLUMNS} FROM label_scans WHERE id = $1 AND source = $2`;
const SELECT_IMAGE_PATH_SQL = 'SELECT image_path FROM label_scans WHERE id = $1 AND source = $2';
const WINE_EXISTS_SQL = 'SELECT 1 FROM wines WHERE slug = $1';

/**
 * Переразметка — тот же UPDATE: разметчик ошибается, и исправление не должно требовать
 * похода в базу руками. notes и предсказание не трогаются — правится только эталон.
 */
const UPDATE_TRUTH_SQL = `
UPDATE label_scans
SET truth_wine_slug = $3, truth_absent = $4, truth_rank = $5
WHERE id = $1 AND source = $2
RETURNING ${SCAN_COLUMNS}`;

const CURSOR_SEPARATOR = '|';

export function formatScanCursor(scan: AdminScan): string {
  return `${scan.createdAt}${CURSOR_SEPARATOR}${scan.id}`;
}

/** null — курсора нет или он испорчен; вызывающий отвечает на это INVALID_REQUEST. */
export function parseScanCursor(cursor: string | undefined): { createdAt: string; id: string } | null {
  if (!cursor) return null;
  const separatorAt = cursor.lastIndexOf(CURSOR_SEPARATOR);
  if (separatorAt <= 0) return null;
  const createdAt = cursor.slice(0, separatorAt);
  const id = cursor.slice(separatorAt + 1);
  const isValid = !Number.isNaN(Date.parse(createdAt)) && /^[0-9a-f-]{36}$/i.test(id);
  return isValid ? { createdAt, id } : null;
}

export function createPgAdminStore(databaseUrl: string): AdminStore {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 2, connectionTimeoutMillis: 15_000, idleTimeoutMillis: 10_000 });

  /** Названия вин для слагов страницы: один запрос на страницу вместо join на каждый кандидат. */
  async function wineTitles(rows: AdminScanRow[]): Promise<WineTitles> {
    const slugs = [...new Set(rows.flatMap(scanSlugs))];
    if (slugs.length === 0) return new Map();
    const { rows: found } = await pool.query<{ slug: string; title: string; manufacturer_name: string | null }>(
      WINE_TITLES_SQL,
      [slugs],
    );
    return new Map(found.map((wine) => [wine.slug, { title: wine.title.trim(), manufacturerName: wine.manufacturer_name }]));
  }

  async function toScans(rows: AdminScanRow[]): Promise<AdminScan[]> {
    const titles = await wineTitles(rows);
    return rows.map((row) => adminScanFromRow(row, titles));
  }

  return {
    async listScans({ filter, limit, cursor }) {
      const after = parseScanCursor(cursor);
      const [{ rows }, { rows: totals }] = await Promise.all([
        pool.query<AdminScanRow>(listScansSql(filter), [
          PRODUCTION_SCAN_SOURCE,
          after?.createdAt ?? null,
          after?.id ?? null,
          limit + 1,
        ]),
        pool.query<{ pending: number }>(PENDING_TOTAL_SQL, [PRODUCTION_SCAN_SOURCE]),
      ]);
      // Лишняя строка запрошена только затем, чтобы узнать, есть ли следующая страница.
      const hasMore = rows.length > limit;
      const items = await toScans(hasMore ? rows.slice(0, limit) : rows);
      const last = items.at(-1);
      return {
        items,
        nextCursor: hasMore && last ? formatScanCursor(last) : null,
        pendingTotal: totals[0]?.pending ?? 0,
      };
    },

    async getScan(scanId) {
      const { rows } = await pool.query<AdminScanRow>(SELECT_SCAN_SQL, [scanId, PRODUCTION_SCAN_SOURCE]);
      if (rows.length === 0) return null;
      const [scan] = await toScans(rows);
      return scan ?? null;
    },

    async setTruth(scanId, input) {
      const { rows } = await pool.query<AdminScanRow>(SELECT_SCAN_SQL, [scanId, PRODUCTION_SCAN_SOURCE]);
      const row = rows[0];
      if (!row) return { status: 'scan_not_found' };

      let truthSlug: string | null = null;
      if (input.kind === 'confirm') {
        if (!row.predicted_wine_slug) return { status: 'no_prediction' };
        truthSlug = row.predicted_wine_slug;
      } else if (input.kind === 'wine') {
        const { rowCount } = await pool.query(WINE_EXISTS_SQL, [input.slug]);
        if (!rowCount) return { status: 'unknown_wine' };
        truthSlug = input.slug;
      }

      const { rows: updated } = await pool.query<AdminScanRow>(UPDATE_TRUTH_SQL, [
        scanId,
        PRODUCTION_SCAN_SOURCE,
        truthSlug,
        input.kind === 'absent',
        truthRankIn(row.candidates, truthSlug),
      ]);
      const savedRow = updated[0];
      if (!savedRow) return { status: 'scan_not_found' };
      const [scan] = await toScans([savedRow]);
      return scan ? { status: 'saved', scan } : { status: 'scan_not_found' };
    },

    async scanImagePath(scanId) {
      const { rows } = await pool.query<{ image_path: string }>(SELECT_IMAGE_PATH_SQL, [scanId, PRODUCTION_SCAN_SOURCE]);
      return rows[0]?.image_path ?? null;
    },

    async searchWines(query, limit) {
      const { rows } = await pool.query<{ slug: string; title: string; manufacturer_name: string | null }>(
        SEARCH_WINES_SQL,
        [query, limit],
      );
      return rows.map((wine) => ({ slug: wine.slug, title: wine.title.trim(), manufacturerName: wine.manufacturer_name }));
    },

    close: () => pool.end(),
  };
}
