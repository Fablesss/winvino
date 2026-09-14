// Read-only отчёт по self-test'у из label_scans, с разбивкой по движку OCR и версии матчера.
// Если движков несколько — прямое сравнение на ОБЩИХ кадрах: только оно честное,
// потому что сравнивает движки на одних и тех же картинках.
import { connect } from './lib/db.mjs';

const SOURCE = 'catalog_selftest';
const client = await connect();
try {
  const { rows: groups } = await client.query(`
    WITH s AS (
      SELECT ls.*, m.name AS truth_winery,
             ls.candidates -> 'wineries' -> 0 ->> 'name' AS winery_top1,
             EXISTS (
               SELECT 1 FROM jsonb_array_elements(ls.candidates -> 'wineries') x
               WHERE x ->> 'name' = m.name
             ) AS winery_in_top3
      FROM label_scans ls
      JOIN wines w ON w.slug = ls.truth_wine_slug
      LEFT JOIN manufacturers m ON m.id = w.manufacturer_id
      WHERE ls.source = $1
    )
    SELECT
      ocr_provider, matcher_version,
      count(*)                                                              AS scans,
      count(*) FILTER (WHERE coalesce(ocr_text, '') = '')                   AS ocr_empty,
      count(*) FILTER (WHERE truth_rank = 1)                                AS top1,
      count(*) FILTER (WHERE truth_rank BETWEEN 1 AND 5)                    AS top5,
      count(*) FILTER (WHERE truth_rank BETWEEN 1 AND 20)                   AS top20,
      count(*) FILTER (WHERE winery_top1 = truth_winery)                    AS winery_top1,
      count(*) FILTER (WHERE winery_in_top3)                                AS winery_top3,
      count(*) FILTER (WHERE winery_top1 = truth_winery AND truth_rank = 1) AS stageb_hit,
      count(*) FILTER (WHERE (candidates->'truth'->>'winery_score')::real >= 0.5) AS winery_readable,
      count(*) FILTER (WHERE (candidates->'truth'->>'title_score')::real  >= 0.5) AS title_readable,
      round(percentile_cont(0.5) WITHIN GROUP (ORDER BY truth_rank)::numeric, 0)  AS median_rank,
      round(avg(length(ocr_text)))                                          AS avg_chars,
      round(avg(ocr_ms))                                                    AS avg_ms
    FROM s
    GROUP BY ocr_provider, matcher_version
    ORDER BY ocr_provider, matcher_version`, [SOURCE]);

  const pct = (k, n) => `${((100 * Number(k)) / Number(n)).toFixed(1)}%`;
  for (const g of groups) {
    const n = g.scans;
    const line = (label, k) => `  ${label.padEnd(36)}${String(k).padStart(5)}  ${pct(k, n)}`;
    console.log(`\n=== ${g.ocr_provider} | матчер ${g.matcher_version} | ${n} сканов ===`);
    console.log(line('пустой OCR', g.ocr_empty));
    console.log(line('top-1', g.top1));
    console.log(line('top-5', g.top5));
    console.log(line('top-20', g.top20));
    console.log(line('ступень A: винодельня в top-1', g.winery_top1));
    console.log(line('ступень A: винодельня в top-3', g.winery_top3));
    console.log(line('эталонная винодельня прочиталась', g.winery_readable));
    console.log(line('эталонное название прочиталось', g.title_readable));
    const pool = Number(g.winery_top1);
    console.log(`  ступень B при верной винодельне: ${pool ? ((100 * Number(g.stageb_hit)) / pool).toFixed(1) : '0'}% из ${pool}`);
    console.log(`  медиана позиции эталона: ${g.median_rank}, средний текст: ${g.avg_chars} симв., OCR: ${g.avg_ms} мс/кадр`);
  }

  const providers = [...new Set(groups.map((g) => g.ocr_provider))];
  if (providers.length >= 2) {
    const [a, b] = providers;
    const { rows: [h] } = await client.query(`
      WITH a AS (SELECT image_path, truth_wine_slug, truth_rank FROM label_scans WHERE source = $1 AND ocr_provider = $2),
           b AS (SELECT image_path, truth_wine_slug, truth_rank FROM label_scans WHERE source = $1 AND ocr_provider = $3)
      SELECT count(*) AS common,
             count(*) FILTER (WHERE a.truth_rank = 1 AND b.truth_rank = 1)                        AS both_top1,
             count(*) FILTER (WHERE a.truth_rank = 1 AND coalesce(b.truth_rank, 99999) <> 1)       AS only_a,
             count(*) FILTER (WHERE b.truth_rank = 1 AND coalesce(a.truth_rank, 99999) <> 1)       AS only_b,
             count(*) FILTER (WHERE coalesce(a.truth_rank, 99999) <> 1 AND coalesce(b.truth_rank, 99999) <> 1) AS neither,
             count(*) FILTER (WHERE a.truth_rank = 1 OR b.truth_rank = 1)                          AS either_top1
      FROM a JOIN b USING (image_path, truth_wine_slug)`, [SOURCE, a, b]);
    const n = h.common;
    console.log(`\n=== лицом к лицу на ${n} общих кадрах (top-1) ===`);
    console.log(`  оба верно                ${String(h.both_top1).padStart(5)}  ${pct(h.both_top1, n)}`);
    console.log(`  только ${a.padEnd(18)}${String(h.only_a).padStart(5)}  ${pct(h.only_a, n)}`);
    console.log(`  только ${b.slice(0, 18).padEnd(18)}${String(h.only_b).padStart(5)}  ${pct(h.only_b, n)}`);
    console.log(`  оба мимо                 ${String(h.neither).padStart(5)}  ${pct(h.neither, n)}`);
    console.log(`  хотя бы один верно       ${String(h.either_top1).padStart(5)}  ${pct(h.either_top1, n)}  <- потолок объединения`);
    if (groups.some((g) => g.matcher_version !== groups[0].matcher_version)) {
      console.log('\n  ВНИМАНИЕ: версии матчера различаются — сначала node scripts/rematch-scans.mjs');
    }
  }

  const { rows: evalRows } = await client.query('SELECT * FROM label_scan_accuracy');
  console.log(`\nвьюха label_scan_accuracy (только eval_set): ${evalRows.length ? JSON.stringify(evalRows) : 'пусто — self-test её не загрязнил'}`);
} finally {
  await client.end();
}
