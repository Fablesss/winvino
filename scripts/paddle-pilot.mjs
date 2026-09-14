// Пилот PaddleOCR: те же кадры, что уже читал tesseract, — прямое сравнение движков.
// В базу не пишет. Кадры берутся из label_scans (source=catalog_selftest), поэтому
// для каждого известен результат tesseract на ТОЙ ЖЕ картинке.
//   node scripts/paddle-pilot.mjs [--n 20] [--det mobile|server] [--min-width 0]
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { connect, projectRoot } from './lib/db.mjs';
import { loadIndex, matchLabel } from './lib/matcher.mjs';

const arg = (name, dflt) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : dflt;
};
const N = Number(arg('--n', 20));
const DET = arg('--det', 'mobile');
const MIN_WIDTH = Number(arg('--min-width', 0));
// oneDNN в paddlepaddle 3.3.1 на CPU падает на каждом кадре — см. ocr/paddle_ocr.py.
const NO_MKLDNN = process.argv.includes('--no-mkldnn');

const PYTHON = path.join(projectRoot, '.venv-ocr', 'Scripts', 'python.exe');
const WORK = path.join(projectRoot, 'data', 'raw', 'paddle-pilot');
fs.mkdirSync(WORK, { recursive: true });
const tag = `${DET}-w${MIN_WIDTH}${NO_MKLDNN ? '-nomkldnn' : ''}`;
const listFile = path.join(WORK, `list-${tag}.txt`);
const outFile = path.join(WORK, `result-${tag}.jsonl`);

const client = await connect();
const index = await loadIndex(client);

// Выборка фиксируется в файле: повторный запуск с другим детектором пойдёт по тем же кадрам.
let sample;
const sampleFile = path.join(WORK, `sample-${N}.json`);
if (fs.existsSync(sampleFile)) {
  sample = JSON.parse(fs.readFileSync(sampleFile, 'utf8'));
} else {
  const { rows } = await client.query(`
    SELECT replace(image_path, '\\', '/') AS file, truth_wine_slug AS slug,
           truth_rank AS tess_rank, ocr_text AS tess_text
    FROM label_scans
    WHERE source = 'catalog_selftest'
    ORDER BY random() LIMIT $1`, [N]);
  sample = rows;
  fs.writeFileSync(sampleFile, JSON.stringify(sample, null, 2));
}
await client.end();

fs.writeFileSync(listFile, sample.map((s) => s.file).join('\n'));
console.log(`кадров: ${sample.length}, детектор: ${DET}, апскейл до ширины: ${MIN_WIDTH || 'нет'}, oneDNN: ${NO_MKLDNN ? 'выкл' : 'вкл'}\n`);

const run = spawnSync(
  PYTHON,
  [
    'ocr/paddle_ocr.py', '--list', listFile, '--out', outFile, '--det', DET,
    '--min-width', String(MIN_WIDTH), ...(NO_MKLDNN ? ['--no-mkldnn'] : []),
  ],
  { cwd: projectRoot, stdio: ['ignore', 'inherit', 'inherit'], env: { ...process.env, PYTHONIOENCODING: 'utf-8' } },
);
if (run.status !== 0) {
  console.error(`python завершился с кодом ${run.status}`);
  process.exit(1);
}

const byFile = new Map(
  fs.readFileSync(outFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).map((r) => [r.file, r]),
);

const stat = { tess: { top1: 0, top5: 0 }, paddle: { top1: 0, top5: 0 }, errors: 0 };
console.log('\n tess paddle  мс   слаг / что прочитал Paddle');
for (const s of sample) {
  const r = byFile.get(s.file);
  if (!r || r.error) { stat.errors += 1; console.log(`  ошибка: ${s.file} ${r?.error ?? 'нет результата'}`); continue; }
  const m = matchLabel(index, r.text, { limit: 5, truthSlug: s.slug });
  const pr = m.truth?.rank ?? null;
  if (s.tess_rank === 1) stat.tess.top1 += 1;
  if (s.tess_rank && s.tess_rank <= 5) stat.tess.top5 += 1;
  if (pr === 1) stat.paddle.top1 += 1;
  if (pr && pr <= 5) stat.paddle.top5 += 1;
  const fmt = (x) => String(x ?? '-').padStart(5);
  console.log(`${fmt(s.tess_rank)} ${fmt(pr)} ${String(r.ms).padStart(5)}  ${s.slug}`);
  console.log(`                    ${r.text.slice(0, 140) || '(пусто)'}`);
}

const n = sample.length - stat.errors;
const pct = (k) => `${((100 * k) / (n || 1)).toFixed(0)}%`;
console.log(`\n=== на одних и тех же ${n} кадрах ===`);
console.log(`  tesseract.js  top1 ${stat.tess.top1} (${pct(stat.tess.top1)})  top5 ${stat.tess.top5} (${pct(stat.tess.top5)})`);
console.log(`  PaddleOCR     top1 ${stat.paddle.top1} (${pct(stat.paddle.top1)})  top5 ${stat.paddle.top5} (${pct(stat.paddle.top5)})`);
if (stat.errors) console.log(`  ошибок распознавания: ${stat.errors}`);
