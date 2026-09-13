// Спайк 2: сравнить подготовку кадра (весь рендер против полосы с этикеткой)
// и матчер на IDF-покрытии. В базу не пишет.
//   node scripts/spike-ocr2.mjs [сколько кадров]
import { createWorker } from 'tesseract.js';
import { connect } from './lib/db.mjs';
import { fetchRender, preprocess } from './lib/render.mjs';
import { loadIndex, matchLabel } from './lib/matcher.mjs';

const SAMPLE = Number(process.argv[2] ?? 20);
const VERBOSE = process.argv.includes('--verbose');

const client = await connect();
const index = await loadIndex(client);
console.log(`индекс: ${index.wines.length} вин, ${index.wineries.length} виноделен, словарь ${index.vocab.size} токенов`);

const { rows: wines } = await client.query(`
  SELECT w.slug, w.title, w.image_url, m.name AS winery
  FROM wines w JOIN manufacturers m ON m.id = w.manufacturer_id
  ORDER BY random() LIMIT $1`, [SAMPLE]);

const worker = await createWorker('rus+eng');
const variants = ['full', 'band', 'both'];
const stats = Object.fromEntries(variants.map((v) => [v, { top1: 0, top5: 0, empty: 0 }]));

try {
  for (const w of wines) {
    const raw = await fetchRender(w.image_url);
    const texts = {};
    for (const variant of ['full', 'band']) {
      const { data } = await worker.recognize(await preprocess(raw, variant));
      texts[variant] = data.text.replace(/\s+/g, ' ').trim();
    }
    texts.both = `${texts.full} ${texts.band}`;

    const line = [];
    for (const variant of variants) {
      if (!texts[variant]) { stats[variant].empty += 1; line.push(`${variant}=пусто`); continue; }
      const { candidates } = matchLabel(index, texts[variant], { limit: 5 });
      const rank = candidates.findIndex((c) => c.slug === w.slug) + 1;
      if (rank === 1) stats[variant].top1 += 1;
      if (rank >= 1 && rank <= 5) stats[variant].top5 += 1;
      line.push(`${variant}=${rank || '-'}`);
      if (VERBOSE && variant === 'full') {
        console.log(`\n--- ${w.slug}\n    эталон: ${w.winery} / ${w.title}`);
        console.log(`    ocr   : ${texts.full.slice(0, 160)}`);
        for (const c of candidates.slice(0, 3)) {
          console.log(`    ${c.score}  ${c.winery_name} / ${c.title}  (w=${c.winery_score} t=${c.title_score} c=${c.category_score})`);
        }
      }
    }
    if (!VERBOSE) console.log(`  ${line.join(' ')}  ${w.slug}`);
  }
} finally {
  await worker.terminate();
  await client.end();
}

console.log(`\n=== итог на ${wines.length} кадрах ===`);
for (const v of variants) {
  const s = stats[v];
  const pct = (n) => `${((100 * n) / wines.length).toFixed(0)}%`;
  console.log(`  ${v.padEnd(5)} top1 ${String(s.top1).padStart(3)} (${pct(s.top1)})  top5 ${String(s.top5).padStart(3)} (${pct(s.top5)})  пустой OCR ${s.empty}`);
}
