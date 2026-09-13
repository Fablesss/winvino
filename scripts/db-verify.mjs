// Read-only проверка приёмочных критериев WIN-1. Ничего не меняет.
import pg from 'pg';
import { connect, maskUrl } from './lib/db.mjs';

const client = await connect();
const show = async (label, sql, params) => {
  const { rows } = await client.query(sql, params);
  console.log(`\n=== ${label} ===`);
  console.log(rows.length ? rows : '(пусто)');
};

try {
  await show('search_path текущей сессии', 'SHOW search_path');

  await show('расширения этой базы и их схемы', `
    SELECT e.extname, e.extversion, n.nspname AS schema
    FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
    WHERE e.extname <> 'plpgsql' ORDER BY e.extname`);

  await show('применённые миграции', `
    SELECT filename, applied_at FROM schema_migrations ORDER BY filename`);

  await show('наполнение каталога', `
    SELECT
      (SELECT count(*) FROM wines)                                      AS wines,
      (SELECT count(DISTINCT manufacturer_id) FROM wines
        WHERE manufacturer_id IS NOT NULL)                              AS wineries_with_wines,
      (SELECT count(*) FROM manufacturers)                              AS manufacturers_total,
      (SELECT count(*) FROM regions)                                    AS regions,
      (SELECT count(*) FROM grapes)                                     AS grapes,
      (SELECT count(*) FROM dishes)                                     AS dishes,
      (SELECT count(*) FROM wine_photos)                                AS photos,
      (SELECT count(*) FROM wine_grapes)                                AS wine_grape_links,
      (SELECT count(*) FROM wine_dishes)                                AS wine_dish_links`);

  await show('полнота данных (дыры должны быть нулями)', `
    SELECT
      count(*) FILTER (WHERE image_url IS NULL)         AS no_image_url,
      count(*) FILTER (WHERE manufacturer_id IS NULL)   AS no_manufacturer,
      count(*) FILTER (WHERE region_id IS NULL)         AS no_region,
      count(*) FILTER (WHERE detail_synced_at IS NULL)  AS detail_not_synced,
      count(*) FILTER (WHERE category_name IS NULL)     AS no_category,
      count(*) FILTER (WHERE description IS NULL)       AS no_description,
      count(*) FILTER (WHERE alcohol IS NULL)           AS no_alcohol,
      count(*) FILTER (WHERE vintage IS NOT NULL)       AS with_vintage
    FROM wines`);

  await show('разбор category на цвет и сахар', `
    SELECT wine_color, sweetness, count(*) AS n
    FROM wines GROUP BY 1, 2 ORDER BY n DESC LIMIT 8`);

  await show('нормализация: ъ и дефисы уходят', `
    SELECT name, name_norm, slug_norm FROM manufacturers
    WHERE name IN ('Абрау-Дюрсо', 'Ведерниковъ', 'Фанагория', 'А. Гордиенко & М. Николаев')
    ORDER BY name`);

  // Ступень A матчера: OCR-строка -> винодельня. Порог 0.3 — дефолт pg_trgm.
  const stageA = `
    SELECT name, slug,
           round(greatest(similarity(name_norm, public.norm_label($1)),
                          similarity(slug_norm, public.norm_label($1)))::numeric, 3) AS score
    FROM manufacturers
    WHERE name_norm % public.norm_label($1) OR slug_norm % public.norm_label($1)
    ORDER BY score DESC LIMIT 3`;

  for (const probe of ['АБРАУ-ДЮРСО', 'ABRAU DURSO', 'Фанагорiя', 'ВЕДЕРНИКОВЪ', 'LOCO CIMBALI']) {
    await show(`ступень A: OCR «${probe}» -> винодельня`, stageA, [probe]);
  }

  // На 158 и 2041 строке планировщик выбирает Seq Scan — и он прав, таблицы крошечные.
  // Поэтому проверяем не «используется ли индекс по умолчанию», а «работоспособен ли он».
  await show('план по умолчанию (wines, 2041 строка)', `
    EXPLAIN (COSTS OFF)
    SELECT title FROM wines WHERE title_norm % public.norm_label('Прибой Марченко')`);

  await client.query('SET enable_seqscan = off');
  await show('тот же запрос с запретом seq scan — индекс рабочий', `
    EXPLAIN (COSTS OFF)
    SELECT title FROM wines WHERE title_norm % public.norm_label('Прибой Марченко')`);
  await client.query('RESET enable_seqscan');

  // Ступень B: внутри найденной винодельни ищем вино. «Рислинг» без винодельни
  // неразрешим (37 вин), с винодельней — однозначен.
  await show('ступень B: «РИСЛИНГ» у Абрау-Дюрсо vs по всему каталогу', `
    SELECT 'внутри винодельни' AS scope, count(*) AS candidates
    FROM wines w JOIN manufacturers m ON m.id = w.manufacturer_id
    WHERE m.name = 'Абрау-Дюрсо' AND w.title_norm = public.norm_label('Рислинг')
    UNION ALL
    SELECT 'по всему каталогу', count(*) FROM wines
    WHERE title_norm = public.norm_label('Рислинг')`);

  await show('сквозной матч: OCR целой этикетки', `
    WITH q AS (SELECT public.norm_label($1) AS t),
    mfr AS (
      SELECT m.id, m.name,
             greatest(similarity(m.name_norm, q.t), similarity(m.slug_norm, q.t)) AS s
      FROM manufacturers m, q
      WHERE m.name_norm % q.t OR m.slug_norm % q.t
      ORDER BY s DESC LIMIT 1
    )
    SELECT mfr.name AS winery, round(mfr.s::numeric,3) AS winery_score,
           w.title, w.category_name, w.public_rating,
           round(similarity(w.title_norm, (SELECT t FROM q))::numeric, 3) AS title_score
    FROM wines w, mfr
    WHERE w.manufacturer_id = mfr.id
    ORDER BY title_score DESC LIMIT 3`,
    ['ВИНОДЕЛЬНЯ МАРЧЕНКО ПРИБОЙ белое полусухое алк. 13% 0,75л']);

  await show('eval-таблица и вьюха метрик на месте', `
    SELECT (SELECT count(*) FROM label_scans) AS scans,
           (SELECT count(*) FROM label_scan_accuracy) AS accuracy_rows,
           (SELECT count(*) FROM information_schema.columns
             WHERE table_name = 'label_scans') AS columns`);

  await show('триграммные индексы', `
    SELECT indexname FROM pg_indexes
    WHERE schemaname = 'public' AND indexdef ILIKE '%gin_trgm_ops%' ORDER BY indexname`);
} finally {
  await client.end();
}

// Доказательство изоляции: в соседней базе кластера расширений нет.
const neighbour = process.env.DATABASE_URL.replace(/\/winvino(\?|$)/, '/postgres$1');
const other = new pg.Client({ connectionString: neighbour, connectionTimeoutMillis: 15000 });
try {
  await other.connect();
  const { rows } = await other.query(`
    SELECT current_database() AS db,
           coalesce(string_agg(extname, ', ' ORDER BY extname), '(только plpgsql)') AS extensions
    FROM pg_extension WHERE extname <> 'plpgsql'`);
  console.log(`\n=== соседняя база (${maskUrl(neighbour).split('/').pop()}): расширения не появились ===`);
  console.log(rows);
} finally {
  await other.end().catch(() => {});
}
