// Read-only отчёт по self-test'у из label_scans. Считается в БД, а не в памяти прогона.
import { connect } from './lib/db.mjs';

const SOURCE = 'catalog_selftest';
const client = await connect();
try {
  const { rows: [r] } = await client.query(`
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
      count(*)                                                           AS scans,
      count(*) FILTER (WHERE ocr_text = '' OR ocr_text IS NULL)          AS ocr_empty,
      count(*) FILTER (WHERE truth_rank = 1)                             AS top1,
      count(*) FILTER (WHERE truth_rank BETWEEN 1 AND 5)                 AS top5,
      count(*) FILTER (WHERE truth_rank BETWEEN 1 AND 20)                AS top20,
      count(*) FILTER (WHERE truth_rank IS NULL OR truth_rank > 5)        AS out_of_top5,
      count(*) FILTER (WHERE winery_top1 = truth_winery)                 AS winery_top1,
      count(*) FILTER (WHERE winery_in_top3)                             AS winery_top3,
      count(*) FILTER (WHERE winery_top1 = truth_winery AND truth_rank = 1) AS stageb_hit,
      round(avg(length(ocr_text)))                                       AS avg_ocr_chars,
      round(avg(ocr_ms))                                                 AS avg_ocr_ms,
      round(avg(truth_rank) FILTER (WHERE truth_rank IS NOT NULL), 1)    AS avg_truth_rank,
      round(percentile_cont(0.5) WITHIN GROUP (ORDER BY truth_rank)::numeric, 0) AS median_truth_rank
    FROM s`, [SOURCE]);

  const n = Number(r.scans);
  const pct = (k) => `${((100 * Number(k)) / n).toFixed(1)}%`;
  const line = (label, k) => `  ${label.padEnd(34)}${String(k).padStart(5)}  ${pct(k)}`;

  console.log(`\n=== ПОТОЛОК на рендерах каталога (${n} кадров, source=${SOURCE}) ===`);
  console.log(line('пустой OCR', r.ocr_empty));
  console.log(line('top-1', r.top1));
  console.log(line('top-5', r.top5));
  console.log(line('top-20', r.top20));
  console.log(line('эталон вне top-5', r.out_of_top5));
  console.log('');
  console.log(line('ступень A: винодельня в top-1', r.winery_top1));
  console.log(line('ступень A: винодельня в top-3', r.winery_top3));
  console.log('');
  const pool = Number(r.winery_top1);
  console.log(`  ступень B в изоляции: при верной винодельне (${pool} кадров)`);
  console.log(`  вино берётся top-1 в ${pool ? ((100 * Number(r.stageb_hit)) / pool).toFixed(1) : '0'}% случаев`);
  console.log('');
  console.log(`  позиция эталона: медиана ${r.median_truth_rank}, средняя ${r.avg_truth_rank} из 2041`);
  console.log(`  средняя длина OCR-текста: ${r.avg_ocr_chars} символов`);
  console.log(`  среднее время OCR на кадр: ${r.avg_ocr_ms} мс`);

  // Где OCR вообще прочёл эталонное название — верхняя граница для ступени B.
  const { rows: [q] } = await client.query(`
    SELECT
      count(*) FILTER (WHERE (candidates->'truth'->>'title_score')::real >= 0.5)  AS title_readable,
      count(*) FILTER (WHERE (candidates->'truth'->>'winery_score')::real >= 0.5) AS winery_readable,
      count(*) AS n
    FROM label_scans WHERE source = $1`, [SOURCE]);
  console.log(`\n  === сколько вообще прочиталось (верхняя граница для матчера) ===`);
  console.log(`  эталонная винодельня набрала >= 0.5 : ${q.winery_readable} / ${q.n}  ${((100 * q.winery_readable) / q.n).toFixed(1)}%`);
  console.log(`  эталонное название набрало  >= 0.5 : ${q.title_readable} / ${q.n}  ${((100 * q.title_readable) / q.n).toFixed(1)}%`);

  const { rows: eval1 } = await client.query(
    'SELECT * FROM label_scan_accuracy',
  );
  console.log(`\n  вьюха label_scan_accuracy (только eval_set): ${eval1.length ? JSON.stringify(eval1) : 'пусто — self-test её не загрязнил'}`);
} finally {
  await client.end();
}
