// Read-only: зависит ли точность от разрешения оригинала рендера.
// Медиана ширины в каталоге ~335px. Если узкие кадры проваливаются заметно чаще,
// следующий шаг — апскейл/серверный детектор; если нет — дело не в разрешении.
import { connect } from './lib/db.mjs';

const client = await connect();
try {
  const { rows } = await client.query(`
    WITH p AS (
      SELECT image_path, truth_wine_slug, truth_rank, (ocr_raw->>'width')::int AS width,
             (candidates->'truth'->>'winery_score')::real AS winery_score
      FROM label_scans
      WHERE source = 'catalog_selftest' AND ocr_provider LIKE 'paddleocr%'
    ),
    t AS (
      SELECT image_path, truth_wine_slug, truth_rank
      FROM label_scans
      WHERE source = 'catalog_selftest' AND ocr_provider = 'tesseract.js rus+eng'
    )
    SELECT
      CASE
        WHEN p.width < 250  THEN '1: < 250px'
        WHEN p.width < 350  THEN '2: 250-349px'
        WHEN p.width < 600  THEN '3: 350-599px'
        WHEN p.width < 1000 THEN '4: 600-999px'
        ELSE                     '5: >= 1000px'
      END AS width_bucket,
      count(*)                                                        AS frames,
      round(100.0 * count(*) FILTER (WHERE p.truth_rank = 1) / count(*), 1)          AS paddle_top1,
      round(100.0 * count(*) FILTER (WHERE p.truth_rank <= 5) / count(*), 1)         AS paddle_top5,
      round(100.0 * count(*) FILTER (WHERE p.winery_score >= 0.5) / count(*), 1)     AS paddle_winery_read,
      round(100.0 * count(*) FILTER (WHERE t.truth_rank = 1) / count(*), 1)          AS tess_top1
    FROM p LEFT JOIN t USING (image_path, truth_wine_slug)
    GROUP BY 1 ORDER BY 1`);
  console.log('\n=== точность по ширине оригинала ===');
  console.table(rows);
} finally {
  await client.end();
}
