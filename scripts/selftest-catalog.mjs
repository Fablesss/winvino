// Self-test: OCR по рендерам самого каталога и матчинг обратно в каталог.
//
// ЭТО ПОТОЛОК, А НЕ ОЖИДАЕМАЯ ТОЧНОСТЬ. Замкнутый контур: запрос и референс происходят
// из одного изображения. Не покрывает угол, блики, освещение, частично закрытую
// этикетку и случай «вина нет в каталоге» (false positive на импорте). Смысл замера в
// другом: если на чистых рендерах не берётся почти 100%, на полке не заработает никогда,
// а разложение отказов показывает, во что именно упираемся.
//
// Пишет в label_scans с source = 'catalog_selftest', чтобы не загрязнять eval_set:
// вьюха label_scan_accuracy считает только по eval_set.
//   node scripts/selftest-catalog.mjs [--limit N] [--workers N]
import crypto from 'node:crypto';
import path from 'node:path';
import { createWorker } from 'tesseract.js';
import { connect } from './lib/db.mjs';
import { fetchRender, preprocess } from './lib/render.mjs';
import { loadIndex, matchLabel, MATCHER_VERSION } from './lib/matcher.mjs';

const SOURCE = 'catalog_selftest';
const OCR_PROVIDER = 'tesseract.js rus+eng';
// band-вариант проверен на выборке и оказался ХУЖЕ полного кадра (top5 18% против 33%):
// фиксированная полоса промахивается по этикетке на бутылках разной формы. Нужна
// настоящая детекция этикетки, это отдельная работа.
const VARIANT = 'full';

const arg = (name, dflt) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? Number(process.argv[i + 1]) : dflt;
};
const limit = arg('--limit', null);
const poolSize = arg('--workers', 4);

const client = await connect();
const index = await loadIndex(client);
console.log(`индекс: ${index.wines.length} вин, ${index.wineries.length} виноделен`);

const { rows: wines } = await client.query(
  `SELECT w.slug, w.title, w.image_url, w.manufacturer_id, m.name AS winery
   FROM wines w LEFT JOIN manufacturers m ON m.id = w.manufacturer_id
   ORDER BY w.slug ${limit ? 'LIMIT ' + limit : ''}`,
);
console.log(`кадров к обработке: ${wines.length}, воркеров: ${poolSize}\n`);

const workers = await Promise.all(
  Array.from({ length: poolSize }, () => createWorker('rus+eng')),
);

const results = [];
const queue = [...wines];
const t0 = Date.now();
let done = 0;

await Promise.all(workers.map(async (worker) => {
  while (queue.length) {
    const w = queue.shift();
    let ocrText = '';
    let ocrMs = 0;
    let sha = null;
    let file = null;
    try {
      const raw = await fetchRender(w.image_url);
      sha = crypto.createHash('sha256').update(raw).digest('hex');
      file = path.join('data/raw/renders', path.basename(w.image_url));
      const png = await preprocess(raw, VARIANT);
      const t = Date.now();
      const { data } = await worker.recognize(png);
      ocrMs = Date.now() - t;
      ocrText = data.text.replace(/\s+/g, ' ').trim();
    } catch (err) {
      console.warn(`  кадр не обработан: ${w.slug} — ${err.message}`);
    }

    const m = matchLabel(index, ocrText, { limit: 5, truthSlug: w.slug });
    const wineryTop1 = m.wineries[0]?.name === w.winery;
    const wineryTop3 = m.wineries.some((x) => x.name === w.winery);

    results.push({
      slug: w.slug,
      winery: w.winery,
      file,
      sha,
      ocrText,
      ocrMs,
      ocrEmpty: !ocrText,
      truthRank: m.truth?.rank ?? null,
      predicted: m.candidates[0]?.slug ?? null,
      predictedScore: m.candidates[0]?.score ?? null,
      wineryTop1,
      wineryTop3,
      payload: { top: m.candidates, wineries: m.wineries, truth: m.truth, variant: VARIANT },
    });

    done += 1;
    if (done % 200 === 0) {
      const rate = done / ((Date.now() - t0) / 1000);
      console.log(`  ${done}/${wines.length}  ${rate.toFixed(1)} кадр/с  осталось ~${Math.round((wines.length - done) / rate / 60)} мин`);
    }
  }
}));

await Promise.all(workers.map((w) => w.terminate()));
console.log(`\nOCR закончен за ${((Date.now() - t0) / 60000).toFixed(1)} мин`);

// --- запись пакетом ---------------------------------------------------------
const col = (key) => results.map((r) => r[key]);
await client.query(
  `INSERT INTO label_scans (source, image_path, image_sha256, ocr_provider, ocr_text, ocr_ms,
                            truth_wine_slug, predicted_wine_slug, predicted_score, truth_rank,
                            candidates, matcher_version, matched_at)
   SELECT $1, p.image_path, p.sha, $2, p.ocr_text, p.ocr_ms, p.truth, p.pred, p.score, p.rank,
          p.payload, $3, now()
   FROM unnest($4::text[], $5::text[], $6::text[], $7::int[], $8::text[], $9::text[],
               $10::real[], $11::int[], $12::jsonb[])
     AS p(image_path, sha, ocr_text, ocr_ms, truth, pred, score, rank, payload)
   ON CONFLICT (source, image_path, truth_wine_slug) DO UPDATE SET
     ocr_provider = EXCLUDED.ocr_provider,
     ocr_text = EXCLUDED.ocr_text,
     ocr_ms = EXCLUDED.ocr_ms,
     predicted_wine_slug = EXCLUDED.predicted_wine_slug,
     predicted_score = EXCLUDED.predicted_score,
     truth_rank = EXCLUDED.truth_rank,
     candidates = EXCLUDED.candidates,
     matcher_version = EXCLUDED.matcher_version,
     matched_at = EXCLUDED.matched_at`,
  [
    SOURCE, OCR_PROVIDER, MATCHER_VERSION,
    col('file'), col('sha'), col('ocrText'), col('ocrMs'), col('slug'), col('predicted'),
    col('predictedScore'), col('truthRank'), results.map((r) => JSON.stringify(r.payload)),
  ],
);
console.log(`записано в label_scans: ${results.length} строк (source=${SOURCE})`);

// --- разложение отказов -----------------------------------------------------
const n = results.length;
const pct = (k) => `${((100 * k) / n).toFixed(1)}%`;
const count = (fn) => results.filter(fn).length;

const empty = count((r) => r.ocrEmpty);
const top1 = count((r) => r.truthRank === 1);
const top5 = count((r) => r.truthRank && r.truthRank <= 5);
// Ранжируем все 2041 кандидата, поэтому «нет позиции» бывает только при пустом OCR.
// Содержательный отказ — это позиция хуже пятой.
const missed = count((r) => r.truthRank === null || r.truthRank > 5);
const wTop1 = count((r) => r.wineryTop1);
const wTop3 = count((r) => r.wineryTop3);
const withOcr = results.filter((r) => !r.ocrEmpty);
const stageBpool = results.filter((r) => r.wineryTop1);
const stageBhit = stageBpool.filter((r) => r.truthRank === 1).length;

console.log(`
=== ПОТОЛОК на рендерах каталога (${n} кадров) ===
  пустой OCR                       ${String(empty).padStart(5)}  ${pct(empty)}
  top-1                            ${String(top1).padStart(5)}  ${pct(top1)}
  top-5                            ${String(top5).padStart(5)}  ${pct(top5)}
  эталон вне top-5                 ${String(missed).padStart(5)}  ${pct(missed)}

  ступень A: винодельня в top-1    ${String(wTop1).padStart(5)}  ${pct(wTop1)}
  ступень A: винодельня в top-3    ${String(wTop3).padStart(5)}  ${pct(wTop3)}

  ступень B в изоляции: когда винодельня угадана верно (${stageBpool.length} кадров),
  вино берётся top-1 в ${stageBpool.length ? ((100 * stageBhit) / stageBpool.length).toFixed(1) : '0'}% случаев

  средняя длина OCR-текста: ${Math.round(withOcr.reduce((s, r) => s + r.ocrText.length, 0) / (withOcr.length || 1))} символов
  среднее время OCR на кадр: ${Math.round(results.reduce((s, r) => s + r.ocrMs, 0) / n)} мс
`);
await client.end();
