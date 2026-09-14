// Перематчинг сохранённого OCR текущей версией матчера — без повторного распознавания.
//
// Нужен, чтобы сравнивать движки OCR честно: разница в точности должна объясняться
// движком, а не тем, что один набор сканов прошёл через старый матчер, а другой — через
// новый. Текст OCR уже лежит в label_scans.ocr_text, так что это секунды, а не часы.
//   node scripts/rematch-scans.mjs [--source catalog_selftest] [--provider "tesseract.js rus+eng"]
import { connect } from './lib/db.mjs';
import { loadIndex, matchLabel, MATCHER_VERSION } from './lib/matcher.mjs';

const arg = (name, dflt) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : dflt;
};
const source = arg('--source', 'catalog_selftest');
const provider = arg('--provider', null);

const client = await connect();
try {
  const { rows } = await client.query(
    `SELECT id, ocr_text, truth_wine_slug FROM label_scans
     WHERE source = $1 AND ($2::text IS NULL OR ocr_provider = $2)`,
    [source, provider],
  );
  console.log(`сканов к перематчингу: ${rows.length} (source=${source}${provider ? `, provider=${provider}` : ''})`);

  const index = await loadIndex(client);
  const t0 = Date.now();
  const updates = rows.map((r) => {
    const m = matchLabel(index, r.ocr_text ?? '', { limit: 5, truthSlug: r.truth_wine_slug });
    return {
      id: r.id,
      pred: m.candidates[0]?.slug ?? null,
      score: m.candidates[0]?.score ?? null,
      rank: m.truth?.rank ?? null,
      payload: JSON.stringify({ top: m.candidates, wineries: m.wineries, truth: m.truth }),
    };
  });
  console.log(`матчинг: ${((Date.now() - t0) / 1000).toFixed(1)} с`);

  const col = (k) => updates.map((u) => u[k]);
  // Прочие ключи candidates (например, variant у tesseract) сохраняются: заменяются
  // только поля, которые считает матчер.
  const { rowCount } = await client.query(
    `UPDATE label_scans s SET
       predicted_wine_slug = p.pred,
       predicted_score     = p.score,
       truth_rank          = p.rank,
       candidates          = (coalesce(s.candidates, '{}'::jsonb) - 'top' - 'wineries' - 'truth') || p.payload,
       matcher_version     = $1,
       matched_at          = now()
     FROM unnest($2::uuid[], $3::text[], $4::real[], $5::int[], $6::jsonb[]) AS p(id, pred, score, rank, payload)
     WHERE s.id = p.id`,
    [MATCHER_VERSION, col('id'), col('pred'), col('score'), col('rank'), col('payload')],
  );
  console.log(`обновлено строк: ${rowCount}, matcher=${MATCHER_VERSION}`);
} finally {
  await client.end();
}
