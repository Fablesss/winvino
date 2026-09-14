// Полный self-test PaddleOCR по каталогу. Два шага, потому что распознавание идёт
// больше часа и должно переживать обрывы:
//
//   1) node scripts/paddle-selftest.mjs list
//        пишет data/raw/paddle-full/list.txt — все уникальные рендеры каталога
//      .venv-ocr\Scripts\python.exe ocr/paddle_ocr.py --list data/raw/paddle-full/list.txt ^
//        --out data/raw/paddle-full/result.jsonl
//        в фоне; при обрыве просто запустить снова — готовые кадры пропускаются
//
//   2) node scripts/paddle-selftest.mjs ingest
//        матчинг и запись в label_scans рядом с результатами tesseract
//
// Результаты ложатся в source = 'catalog_selftest' с отдельным ocr_provider, поэтому
// оба движка хранятся на одних и тех же кадрах и сравниваются напрямую.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { connect, projectRoot } from './lib/db.mjs';
import { loadIndex, matchLabel, MATCHER_VERSION } from './lib/matcher.mjs';

const SOURCE = 'catalog_selftest';
const WORK = path.join(projectRoot, 'data', 'raw', 'paddle-full');
const LIST = path.join(WORK, 'list.txt');
const OUT = path.join(WORK, 'result.jsonl');

const command = process.argv[2];
if (!['list', 'ingest'].includes(command)) {
  console.error('использование: node scripts/paddle-selftest.mjs list|ingest');
  process.exit(2);
}

/** Путь кадра в том же виде, что пишет selftest-catalog.mjs: всегда с прямыми слешами. */
const renderPath = (imageUrl) => `data/raw/renders/${path.basename(imageUrl)}`;

const client = await connect();
try {
  const { rows: wines } = await client.query('SELECT slug, image_url FROM wines ORDER BY slug');

  // Один файл может принадлежать двум винам (4 такие пары) — поэтому файл -> список эталонов.
  const slugsByFile = new Map();
  for (const w of wines) {
    const file = renderPath(w.image_url);
    if (!slugsByFile.has(file)) slugsByFile.set(file, []);
    slugsByFile.get(file).push(w.slug);
  }

  if (command === 'list') {
    fs.mkdirSync(WORK, { recursive: true });
    const files = [...slugsByFile.keys()];
    const missing = files.filter((f) => !fs.existsSync(path.join(projectRoot, f)));
    fs.writeFileSync(LIST, files.join('\n'));
    console.log(`уникальных рендеров: ${files.length} (вин: ${wines.length})`);
    console.log(`нет в локальном кеше: ${missing.length}${missing.length ? ' — сначала npm run selftest скачает их' : ''}`);
    console.log(`список: ${path.relative(projectRoot, LIST)}`);
  }

  if (command === 'ingest') {
    // Последняя запись по файлу выигрывает: после перезапуска успешный кадр
    // перекрывает ошибку, записанную до него.
    const records = new Map();
    for (const line of fs.readFileSync(OUT, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const r = JSON.parse(line);
        records.set(r.file, r);
      } catch {
        // оборванная последняя строка при убитом процессе
      }
    }
    console.log(`записей в JSONL: ${records.size} из ${slugsByFile.size} кадров`);

    const index = await loadIndex(client);
    const rows = [];
    for (const [file, slugs] of slugsByFile) {
      const r = records.get(file);
      if (!r) continue;
      const bytes = fs.readFileSync(path.join(projectRoot, file));
      const sha = crypto.createHash('sha256').update(bytes).digest('hex');
      const text = r.error ? '' : (r.text ?? '');
      for (const slug of slugs) {
        const m = matchLabel(index, text, { limit: 5, truthSlug: slug });
        rows.push({
          file,
          sha,
          provider: r.engine,
          text,
          ms: r.ms ?? null,
          raw: JSON.stringify({ lines: r.lines ?? [], width: r.width, height: r.height, min_width: r.min_width, error: r.error ?? null }),
          slug,
          pred: m.candidates[0]?.slug ?? null,
          score: m.candidates[0]?.score ?? null,
          rank: m.truth?.rank ?? null,
          payload: JSON.stringify({ top: m.candidates, wineries: m.wineries, truth: m.truth }),
        });
      }
    }

    const col = (k) => rows.map((r) => r[k]);
    await client.query(
      `INSERT INTO label_scans (source, image_path, image_sha256, ocr_provider, ocr_text, ocr_ms, ocr_raw,
                                truth_wine_slug, predicted_wine_slug, predicted_score, truth_rank,
                                candidates, matcher_version, matched_at)
       SELECT $1, p.image_path, p.sha, p.provider, p.ocr_text, p.ocr_ms, p.ocr_raw,
              p.truth, p.pred, p.score, p.rank, p.payload, $2, now()
       FROM unnest($3::text[], $4::text[], $5::text[], $6::text[], $7::int[], $8::jsonb[],
                   $9::text[], $10::text[], $11::real[], $12::int[], $13::jsonb[])
         AS p(image_path, sha, provider, ocr_text, ocr_ms, ocr_raw, truth, pred, score, rank, payload)
       ON CONFLICT (source, image_path, truth_wine_slug, ocr_provider) DO UPDATE SET
         image_sha256        = EXCLUDED.image_sha256,
         ocr_text            = EXCLUDED.ocr_text,
         ocr_ms              = EXCLUDED.ocr_ms,
         ocr_raw             = EXCLUDED.ocr_raw,
         predicted_wine_slug = EXCLUDED.predicted_wine_slug,
         predicted_score     = EXCLUDED.predicted_score,
         truth_rank          = EXCLUDED.truth_rank,
         candidates          = EXCLUDED.candidates,
         matcher_version     = EXCLUDED.matcher_version,
         matched_at          = EXCLUDED.matched_at`,
      [
        SOURCE, MATCHER_VERSION,
        col('file'), col('sha'), col('provider'), col('text'), col('ms'), col('raw'),
        col('slug'), col('pred'), col('score'), col('rank'), col('payload'),
      ],
    );
    console.log(`записано в label_scans: ${rows.length} строк (source=${SOURCE}, matcher=${MATCHER_VERSION})`);
  }
} finally {
  await client.end();
}
