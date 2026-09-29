// Офлайн-оценка распознавателя тем же путём, что отвечает сервис, и обучение слияния.
//
//   node scripts/eval-recognizer.mjs --checkpoint data/raw/model/checkpoints/ft1-best.pt \
//        --synthetic 300:1000 --fit 300:700 --write-config
//   node scripts/eval-recognizer.mjs --records data/raw/model/eval-records-ft1.jsonl --fit 300:700   # без моделей
//
// Синтетика: data/raw/dataset/synthetic-eval (первые 300 кадров — отбор чекпойнта при
// обучении, поэтому слияние учится на 300:700, а меряется на 700:1000 и реальных фото).
// Реальные: data/raw/dataset/real/queries.jsonl, эталон — точный слаг; slug null — вина
// нет в каталоге, такие кадры показывают, какую уверенность получает «уверенное враньё».
// Кадры из data/eval-exclusions.jsonl в top-1 не идут: там ошибка от данных, а не от распознавания.
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_WEIGHTS, fitWeights, scoreCandidates } from './lib/fusion.mjs';
import { readManifest } from './lib/catalog-manifest.mjs';
import { CONFIG_PATH, createRecognizer, DATA_DIR, loadConfig, MANIFEST_PATH, ROOT } from './lib/recognizer.mjs';

const arg = (name, fallback = null) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const flag = (name) => process.argv.includes(`--${name}`);
const range = (s) => { const [a, b] = s.split(':').map(Number); return [a, b]; };

const MODEL_DIR = path.join(ROOT, 'data', 'raw', 'model');
// --synthetic-manifest подставляет другой синтетический набор (например собранный из крупных
// рендеров в большом кадре, где текст этикетки читается) — см. ml/evalset.py.
const SYNTH_MANIFEST = path.resolve(ROOT, arg('synthetic-manifest',
  path.join('data', 'raw', 'dataset', 'synthetic-eval', 'queries-1-1000.jsonl')));
const REAL_MANIFEST = path.join(ROOT, 'data', 'raw', 'dataset', 'real', 'queries.jsonl');
const OCR_CACHE = path.join(MODEL_DIR, 'ocr-cache.jsonl');
// --exclusions подменяет список целиком: так «а что будет, если убрать ещё и эти кадры»
// считается, не трогая закоммиченный набор.
const EXCLUSIONS = path.resolve(ROOT, arg('exclusions', path.join('data', 'eval-exclusions.jsonl')));

const readJsonl = (p) => fs.readFileSync(p, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));

// Ключ кадра — «папка набора/файл», как в EXCLUSIONS; записи с Windows хранят путь через «\».
const frameKey = (file) => file.replaceAll('\\', '/').split('/').slice(-2).join('/');
const excluded = new Set(readJsonl(EXCLUSIONS).map((e) => e.file));
/** Кадр идёт в оценку. Кадры без эталона — проверка отказа, они остаются, хоть и в списке. */
const scored = (q) => q.set === 'real_absent' || !excluded.has(frameKey(q.file));

// Слаги-двойники: одно вино заведено в каталоге дважды. Ответ «то же вино, другой слаг» —
// не ошибка распознавания, поэтому любой слаг класса считается верным. Файл собирается
// scripts/build-eval-exclusions.mjs; без --twins поведение прежнее.
const twins = new Map(Object.entries(arg('twins') ? JSON.parse(fs.readFileSync(path.resolve(ROOT, arg('twins')), 'utf8')) : {}));
const withTwins = (slugs) => new Set(slugs.flatMap((s) => [s, ...(twins.get(s) ?? [])]));

function loadQueries(synthRange) {
  const slugsByImage = new Map();
  for (const e of readManifest(MANIFEST_PATH)) {
    const name = path.basename(e.image);
    if (!slugsByImage.has(name)) slugsByImage.set(name, []);
    slugsByImage.get(name).push(e.slug);
  }
  const [a, b] = synthRange;
  const synth = readJsonl(SYNTH_MANIFEST).slice(a, b).map((q, i) => ({
    set: 'synthetic', idx: a + i, file: path.join(path.dirname(SYNTH_MANIFEST), q.file),
    correct: slugsByImage.get(q.target_image) ?? [],
  }));
  const real = readJsonl(REAL_MANIFEST).map((q, i) => ({
    set: q.slug ? 'real' : 'real_absent', idx: i, file: path.join(path.dirname(REAL_MANIFEST), q.file),
    correct: q.slug ? [q.slug] : [],
  }));
  return [...synth, ...real].filter(scored);
}

function metrics(records, weights) {
  const out = {};
  for (const set of [...new Set(records.map((r) => r.set))]) {
    const rs = records.filter((r) => r.set === set);
    let top1 = 0; let top5 = 0; let inPool = 0;
    const confRight = []; const confWrong = [];
    const bins = Array.from({ length: 10 }, () => ({ n: 0, conf: 0, acc: 0 }));
    for (const r of rs) {
      const ranked = scoreCandidates(r.cands, weights);
      const correct = withTwins(r.correct);
      const hit1 = ranked[0] && correct.has(ranked[0].slug);
      top1 += hit1 ? 1 : 0;
      top5 += ranked.slice(0, 5).some((c) => correct.has(c.slug)) ? 1 : 0;
      inPool += ranked.some((c) => correct.has(c.slug)) ? 1 : 0;
      const conf = ranked[0]?.p ?? 0;
      (hit1 ? confRight : confWrong).push(conf);
      const b = bins[Math.min(9, Math.floor(conf * 10))];
      b.n += 1; b.conf += conf; b.acc += hit1 ? 1 : 0;
    }
    const n = rs.length;
    const mean = (xs) => (xs.length ? Number((xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(3)) : null);
    const ece = bins.reduce((acc, b) => acc + (b.n ? (b.n / n) * Math.abs(b.acc / b.n - b.conf / b.n) : 0), 0);
    out[set] = set === 'real_absent'
      ? { n, confidences: rs.map((r) => Number((scoreCandidates(r.cands, weights)[0]?.p ?? 0).toFixed(3))) }
      : {
        n,
        top1: Number((top1 / n).toFixed(4)),
        top5: Number((top5 / n).toFixed(4)),
        recall_pool: Number((inPool / n).toFixed(4)),
        conf_when_right: mean(confRight),
        conf_when_wrong: mean(confWrong),
        ece: Number(ece.toFixed(4)),
      };
  }
  return out;
}

async function collect(queries, checkpoint, tag) {
  const cache = new Map();
  if (fs.existsSync(OCR_CACHE)) for (const r of readJsonl(OCR_CACHE)) cache.set(r.key, r.value);
  const sizeBefore = cache.size;
  const rec = createRecognizer({ config: { checkpoint: checkpoint && path.resolve(ROOT, checkpoint), weights: DEFAULT_WEIGHTS } });
  await rec.ready;
  const records = [];
  const ms = [];
  try {
    for (const [i, q] of queries.entries()) {
      const res = await rec.recognize(q.file, { ocrCache: cache });
      ms.push(res.ms);
      records.push({
        set: q.set, idx: q.idx, file: path.relative(ROOT, q.file), correct: q.correct,
        ocr_text: res.ocr_text, box_source: res.box_source,
        cands: res._ranked.map((c) => ({ slug: c.slug, x: c.x })),
      });
      if ((i + 1) % 50 === 0) console.log(`  ${i + 1}/${queries.length}, последний: ${JSON.stringify(res.ms)}`);
    }
  } finally {
    rec.stop();
    const fresh = [...cache].slice(sizeBefore).map(([key, value]) => JSON.stringify({ key, value }));
    if (fresh.length) fs.appendFileSync(OCR_CACHE, `${fresh.join('\n')}\n`);
  }
  const out = path.join(MODEL_DIR, `eval-records-${tag}.jsonl`);
  fs.writeFileSync(out, `${records.map((r) => JSON.stringify(r)).join('\n')}\n`);
  const avg = (k) => Math.round(ms.reduce((a, m) => a + m[k], 0) / ms.length);
  console.log(`записи → ${path.relative(ROOT, out)}; среднее время, мс: visual ${avg('visual')}, ocr ${avg('ocr')}, total ${avg('total')}`);
  return records;
}

const checkpoint = arg('checkpoint');
const tag = arg('tag', checkpoint ? path.basename(checkpoint, '.pt') : 'zeroshot');
const records = arg('records')
  ? readJsonl(path.resolve(ROOT, arg('records'))).filter(scored)
  : await collect(loadQueries(range(arg('synthetic', '300:1000'))), checkpoint, tag);
console.log(`исключено из top-1 по ${path.relative(ROOT, EXCLUSIONS)}, кадров: ${excluded.size} (без эталона остаются проверкой отказа)`);

console.log('\nвеса по умолчанию (визуал + слабый текст):');
console.log(JSON.stringify(metrics(records, DEFAULT_WEIGHTS), null, 1));

if (arg('fit')) {
  const [a, b] = range(arg('fit'));
  const isTrain = (r) => r.set === 'synthetic' && r.idx >= a && r.idx < b;
  const train = records.filter(isTrain).map((r) => ({ cands: r.cands, correct: withTwins(r.correct) }));
  console.log(`\nобучение слияния на синтетике ${a}:${b} (${train.length} запросов)`);
  const weights = fitWeights(train);
  console.log('веса:', JSON.stringify(Object.fromEntries(Object.entries(weights).map(([k, v]) => [k, Number(v.toFixed(3))]))));
  const held = records.filter((r) => !isTrain(r));
  const m = metrics(held, weights);
  const brief = (x) => Object.fromEntries(Object.entries(x).map(([k, v]) => [k, v.top1 ?? v.confidences]));
  console.log('на отложенных, top-1 (реальные вне каталога — уверенность):');
  console.log('  по умолчанию:', JSON.stringify(brief(metrics(held, DEFAULT_WEIGHTS))));
  console.log('  обученные:   ', JSON.stringify(brief(m)));
  console.log(JSON.stringify(m, null, 1));
  if (flag('write-config')) {
    const cfg = {
      ...loadConfig(),
      // От корня артефактов: тот же конфиг работает и локально, и из тома с бандлом в контейнере.
      checkpoint: checkpoint ? path.relative(DATA_DIR, path.resolve(ROOT, checkpoint)).split(path.sep).join('/') : null,
      weights,
      fitted: { on: `synthetic ${a}:${b}`, at: new Date().toISOString(), heldout: m },
    };
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
    console.log(`→ ${path.relative(ROOT, CONFIG_PATH)}`);
  }
}
