// Read-only: почему ступень B промахивается, когда винодельня уже угадана верно.
import { connect } from './lib/db.mjs';

const client = await connect();
try {
  const { rows } = await client.query(`
    SELECT s.truth_wine_slug, w.title AS truth_title, m.name AS truth_winery,
           s.truth_rank, s.ocr_text, s.candidates
    FROM label_scans s
    JOIN wines w ON w.slug = s.truth_wine_slug
    LEFT JOIN manufacturers m ON m.id = w.manufacturer_id
    WHERE s.source = 'catalog_selftest'
      AND s.truth_rank > 1
      AND s.candidates -> 'wineries' -> 0 ->> 'name' = m.name
    ORDER BY s.truth_rank
    LIMIT 8`);

  for (const r of rows) {
    console.log(`\n--- ${r.truth_winery} / ${r.truth_title}   (эталон на позиции ${r.truth_rank})`);
    console.log(`    ocr: ${(r.ocr_text ?? '').slice(0, 170)}`);
    const truth = r.candidates.truth ?? {};
    console.log(`    эталон получил: winery=${truth.winery_score} title=${truth.title_score} score=${truth.score}`);
    console.log('    кто обошёл:');
    for (const c of (r.candidates.top ?? []).slice(0, 3)) {
      console.log(`      ${c.score}  «${c.title}»  w=${c.winery_score} t=${c.title_score} c=${c.category_score}`);
    }
  }

  // Систематическая проверка гипотезы: короткие названия выигрывают из-за того, что
  // покрытие нормируется на длину названия.
  const { rows: len } = await client.query(`
    WITH sel AS (
      SELECT s.truth_rank,
             array_length(string_to_array(w.title_norm, ' '), 1) AS truth_tokens,
             (SELECT array_length(string_to_array(public.norm_label(c->>'title'), ' '), 1)
              FROM jsonb_array_elements(s.candidates->'top') c LIMIT 1) AS winner_tokens
      FROM label_scans s JOIN wines w ON w.slug = s.truth_wine_slug
      WHERE s.source = 'catalog_selftest' AND s.ocr_text <> ''
    )
    SELECT
      round(avg(truth_tokens)::numeric, 2)  AS avg_tokens_in_truth,
      round(avg(winner_tokens)::numeric, 2) AS avg_tokens_in_winner,
      count(*) FILTER (WHERE winner_tokens < truth_tokens) AS winner_shorter,
      count(*) FILTER (WHERE winner_tokens > truth_tokens) AS winner_longer,
      count(*) AS n
    FROM sel`);
  console.log('\n=== длина названия: эталон против победителя ===');
  console.log(len[0]);
} finally {
  await client.end();
}
