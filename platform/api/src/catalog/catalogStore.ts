import type { Wine } from '@winvino/contract';
import pg from 'pg';
import { wineFromCatalogRow, type CatalogWineRow } from './wineFromCatalogRow.ts';

/** Тот же SELECT, которым выгружен мок-каталог: строка — ровно CatalogWineRow. */
export const CATALOG_SELECT = `
SELECT w.id, w.slug, w.title, w.category_name, w.wine_color, w.sweetness, w.hue,
       w.public_rating, w.alcohol, w.serve_temperature, w.description, w.image_url, w.vintage,
       m.slug AS manufacturer_slug, m.name AS manufacturer_name, r.name AS region_name,
       COALESCE((SELECT array_agg(g.name ORDER BY g.name) FROM wine_grapes wg JOIN grapes g ON g.id = wg.grape_id WHERE wg.wine_id = w.id), '{}') AS grapes,
       COALESCE((SELECT array_agg(d.name ORDER BY d.name) FROM wine_dishes wd JOIN dishes d ON d.id = wd.dish_id WHERE wd.wine_id = w.id), '{}') AS dishes
FROM wines w
LEFT JOIN manufacturers m ON m.id = w.manufacturer_id
LEFT JOIN regions r ON r.id = w.region_id`;

export type CatalogLoader = { load: () => Promise<CatalogWineRow[]>; close: () => Promise<void> };

/** TLS — через sslmode в DATABASE_URL (например `?sslmode=no-verify` для самоподписанного сертификата). */
export function createPgCatalogLoader(databaseUrl: string): CatalogLoader {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 15_000, idleTimeoutMillis: 10_000 });
  return {
    load: async () => (await pool.query<CatalogWineRow>(CATALOG_SELECT)).rows,
    close: () => pool.end(),
  };
}

export type CatalogStore = {
  /** Вино по слагу; undefined — слага нет в каталоге сайта (снят с продажи, не в зеркале). */
  get(slug: string): Wine | undefined;
  isLoaded(): boolean;
  size(): number;
  /** Первая попытка загрузки завершилась (успешно или нет). */
  firstAttempt: Promise<void>;
  stop(): void;
};

/**
 * Каталог в памяти: ~2 тыс. строк грузятся одним SELECT при старте и обновляются по таймеру.
 * Распознаванию не нужна база на каждый запрос, а короткий обрыв связи после старта не
 * ломает ответы — работает последняя загруженная копия. Пока копии нет, повторяем чаще.
 */
export function createCatalogStore(options: {
  load: () => Promise<CatalogWineRow[]>;
  refreshMs: number;
  retryMs?: number;
  log?: Pick<Console, 'log' | 'error'>;
}): CatalogStore {
  const { load, refreshMs, retryMs = 5_000, log = console } = options;
  let wines = new Map<string, Wine>();
  let loaded = false;
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;

  const schedule = (ms: number) => {
    if (stopped) return;
    timer = setTimeout(() => void refresh(), ms);
    timer.unref();
  };

  async function refresh(): Promise<void> {
    try {
      const rows = await load();
      wines = new Map(rows.map((row) => [row.slug, wineFromCatalogRow(row)]));
      loaded = true;
      log.log(JSON.stringify({ event: 'catalog_loaded', wines: wines.size }));
      schedule(refreshMs);
    } catch (error) {
      log.error(JSON.stringify({ event: 'catalog_load_failed', message: (error as Error).message, keepingPrevious: loaded }));
      schedule(loaded ? refreshMs : retryMs);
    }
  }

  return {
    get: (slug) => wines.get(slug),
    isLoaded: () => loaded,
    size: () => wines.size,
    firstAttempt: refresh(),
    stop() {
      stopped = true;
      clearTimeout(timer);
    },
  };
}
