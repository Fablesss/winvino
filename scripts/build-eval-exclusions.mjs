// Список исключений eval-набора из выгрузки ml/dupes.py: кадры, чей эталон попал в пару с
// испорченным фото каталога.
//
// Исключаются две группы: «одно фото на разные вина» (разным винам выдан один файл) и
// «дубль одного вина» (одно вино под двумя слагами). Группа «разные вина, похожий дизайн»
// НЕ исключается — фото там разные, это задача распознавания (WIN-12), и выкинуть её значило
// бы завысить точность.
//
// Правило: исключаем по признаку, а не по исходу. Скрипт не открывает
// записи прогона вообще, поэтому вместе с ошибками уходят и удачные попадания.
//
//   node scripts/build-eval-exclusions.mjs --out data/eval-exclusions-dupes.jsonl
//   node scripts/eval-recognizer.mjs --records data/raw/model/eval-records-ft1-best-v5.jsonl \
//        --exclusions data/eval-exclusions-dupes.jsonl
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './lib/recognizer.mjs';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};

// Имена групп заданы в ml/dupes.py (BROKEN_PHOTO, DUPLICATE_WINE, SAME_DESIGN), менять вместе.
//
// Исключается только «одно фото на разные вина»: там правильного ответа нет физически.
// «Дубль одного вина» решается иначе — слаги-двойники идут в --twins и засчитываются как
// верный ответ. Выкидывать их кадры бессмысленно: фото у дублей чаще всего разные, модель
// такие кадры берёт, и исключение снимало бы попадания (проверено: 88.7% → 88.55%).
const DUPLICATE_WINE = 'дубль одного вина';
const REASON_BY_GROUP = new Map([
  ['одно фото на разные вина', 'same_image'],
]);
// --with-design добавляет третью группу. Это НЕ метрика: так меряется потолок «если бы вина
// одной линейки не надо было различать», то есть ровно та задача, ради которой заведена WIN-12.
if (process.argv.includes('--with-design')) REASON_BY_GROUP.set('разные вина, похожий дизайн', 'same_design');

const pairsPath = path.resolve(ROOT, arg('pairs', 'data/raw/dataset/dupes/pairs.json'));
const basePath = path.resolve(ROOT, arg('base', 'data/eval-exclusions.jsonl'));
const outPath = path.resolve(ROOT, arg('out', 'data/eval-exclusions-dupes.jsonl'));
const twinsPath = path.resolve(ROOT, arg('twins-out', 'data/eval-twins.json'));
const synthManifest = path.resolve(ROOT, 'data/raw/dataset/synthetic-eval/queries-1-1000.jsonl');
const realManifest = path.resolve(ROOT, 'data/raw/dataset/real/queries.jsonl');

const readJsonl = (p) => fs.readFileSync(p, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));

// --- слаг → причина и двойники ---
const reasonBySlug = new Map();
const twinsBySlug = new Map();
const noteBySlug = new Map();
const pairs = JSON.parse(fs.readFileSync(pairsPath, 'utf8'));
for (const p of pairs) {
  const reason = REASON_BY_GROUP.get(p.group);
  if (!reason) continue;
  for (const [self, other] of [['a', 'b'], ['b', 'a']]) {
    const slug = p[`slug_${self}`];
    // same_image сильнее duplicate_slug: если вино и там и там, причина — чужое фото.
    if (!reasonBySlug.has(slug) || reason === 'same_image') reasonBySlug.set(slug, reason);
    if (!twinsBySlug.has(slug)) twinsBySlug.set(slug, new Set());
    twinsBySlug.get(slug).add(p[`slug_${other}`]);
    if (!noteBySlug.has(slug)) {
      noteBySlug.set(slug, `${p.group} (${p.kind}, сходство ${p.sim}): `
        + `${p[`winery_${self}`]} / ${p[`title_${self}`]} — ${p[`winery_${other}`]} / ${p[`title_${other}`]}`);
    }
  }
}

// --- кадры, чей эталон в этом списке ---
const frames = [
  ...readJsonl(synthManifest).map((q) => ({ key: `synthetic-eval/${q.file}`, slug: q.slug })),
  ...readJsonl(realManifest).map((q) => ({ key: `real/${q.file}`, slug: q.slug })),
];

const base = readJsonl(basePath);
const byFile = new Map(base.map((e) => [e.file, e]));
let added = 0;
for (const f of frames) {
  if (!f.slug || !reasonBySlug.has(f.slug) || byFile.has(f.key)) continue;
  byFile.set(f.key, {
    file: f.key,
    slug: f.slug,
    reason: reasonBySlug.get(f.slug),
    twins: [...twinsBySlug.get(f.slug)],
    note: noteBySlug.get(f.slug),
  });
  added += 1;
}

const rows = [...byFile.values()].sort((x, y) => x.file.localeCompare(y.file));
fs.writeFileSync(outPath, `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`);

// --- слаги-двойники: классы эквивалентности одного вина ---
// Союз транзитивен: «Арпачино. Иноходец» заведён четырьмя слагами, и верным должен считаться
// любой из них, иначе мы наказываем модель за то, что каталог завёл вино дважды.
const parent = new Map();
const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
const union = (x, y) => {
  for (const s of [x, y]) if (!parent.has(s)) parent.set(s, s);
  const [a, b] = [find(x), find(y)];
  if (a !== b) parent.set(a, b);
};
for (const p of pairs) if (p.group === DUPLICATE_WINE) union(p.slug_a, p.slug_b);
const classes = new Map();
for (const slug of parent.keys()) {
  const root = find(slug);
  if (!classes.has(root)) classes.set(root, []);
  classes.get(root).push(slug);
}
const twins = {};
for (const group of classes.values()) {
  for (const slug of group) twins[slug] = group.filter((s) => s !== slug).sort();
}
fs.writeFileSync(twinsPath, `${JSON.stringify(twins, null, 1)}\n`);
const sizes = [...classes.values()].map((g) => g.length);
console.log(`двойники: ${Object.keys(twins).length} слагов в ${classes.size} классах, крупнейший ${Math.max(0, ...sizes)}`);
console.log(`→ ${path.relative(ROOT, twinsPath)}`);

const byReason = (list) => {
  const m = new Map();
  for (const e of list) m.set(e.reason, (m.get(e.reason) ?? 0) + 1);
  return [...m].sort().map(([k, v]) => `${k} ${v}`).join(', ');
};
console.log(`слагов в выгрузке под исключение: ${reasonBySlug.size}`);
console.log(`было ${base.length} (${byReason(base)})`);
console.log(`добавлено ${added}, стало ${rows.length} (${byReason(rows)})`);
console.log(`→ ${path.relative(ROOT, outPath)}`);
