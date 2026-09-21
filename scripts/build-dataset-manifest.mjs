// Манифест датасета: каждый slug из CSV-выгрузки Strapi → файл-оригинал в дампе uploads.
//
// CSV — каталог, по которому проверяет организатор (2103 слага), зеркало в базе — 2041.
// Поэтому список вин берётся из CSV, а база служит точной подсказкой пути.
//
// Как ищется файл, по убыванию надёжности:
//   db        — wines.image_url из зеркала API: точное имя файла в uploads;
//   csv_name  — имя фото из CSV, прогнанное через тот же slugify, что Strapi применяет
//               при загрузке (@sindresorhus/slugify 1.1.0, separator '_', без lowercase),
//               + суффикс _<10 hex>. Один кандидат;
//   csv_name_latest — кандидатов несколько (файл с таким именем грузили повторно),
//               берётся самый свежий по mtime. Помечается ambiguous.
//
//   node scripts/build-dataset-manifest.mjs [--csv путь] [--uploads путь] [--out каталог]
import fs from 'node:fs';
import path from 'node:path';
import slugify from '@sindresorhus/slugify';
import { connect, projectRoot } from './lib/db.mjs';
import { parseCsvObjects } from './lib/csv.mjs';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const csvPath = path.resolve(projectRoot, arg('csv', 'Датасет/strapi_output0709.csv'));
const uploadsDir = path.resolve(projectRoot, arg('uploads', 'data/raw/strapi/prod-svoe-vino-strapi/prod-svoe-vino/strapi/uploads'));
const outDir = path.resolve(projectRoot, arg('out', 'data/raw/dataset'));

const VARIANT_PREFIX = /^(thumbnail|small|medium|large)_/;
const HASH_SUFFIX = /_[0-9a-f]{10}$/;
const IMAGE_EXT = new Set(['.webp', '.jpg', '.jpeg', '.png', '.jfif', '.tif', '.tiff', '.heic']);

/** Имя файла в uploads, которое Strapi сгенерировал бы из исходного имени (без хэша и расширения). */
function strapiBaseName(originalName) {
  const base = originalName.replace(/\.[^.]+$/, '');
  return slugify(base, { separator: '_', lowercase: false });
}

// --- uploads: base → оригиналы ---
const uploadsByBase = new Map();
const uploadFiles = new Set();
for (const name of fs.readdirSync(uploadsDir)) {
  const ext = path.extname(name).toLowerCase();
  if (!IMAGE_EXT.has(ext) || VARIANT_PREFIX.test(name)) continue;
  uploadFiles.add(name);
  const base = path.basename(name, path.extname(name)).replace(HASH_SUFFIX, '');
  if (!uploadsByBase.has(base)) uploadsByBase.set(base, []);
  uploadsByBase.get(base).push(name);
}

// --- CSV: дубли строк схлопываются, расхождения внутри слага — ошибка данных ---
const rows = parseCsvObjects(fs.readFileSync(csvPath, 'utf8'));
const bySlug = new Map();
const conflicts = [];
for (const r of rows) {
  const prev = bySlug.get(r.Slug);
  if (!prev) bySlug.set(r.Slug, r);
  else if (JSON.stringify(prev) !== JSON.stringify(r)) conflicts.push(r.Slug);
}

// --- база: slug → точное имя файла ---
const client = await connect();
const { rows: dbWines } = await client.query('SELECT slug, image_url FROM wines WHERE image_url IS NOT NULL');
await client.end();
const dbFileBySlug = new Map(dbWines.map((w) => [w.slug, path.basename(w.image_url)]));

const mtime = (name) => fs.statSync(path.join(uploadsDir, name)).mtimeMs;
const relUploads = path.relative(projectRoot, uploadsDir).split(path.sep).join('/');

const entries = [];
for (const [slug, r] of bySlug) {
  const photo = r['Название фото'];
  const csvCandidates = uploadsByBase.get(strapiBaseName(photo)) ?? [];
  const dbFile = dbFileBySlug.get(slug);
  const dbHit = dbFile && uploadFiles.has(dbFile) ? dbFile : null;

  let file = null;
  let method = null;
  if (dbHit) {
    file = dbHit;
    method = 'db';
  } else if (csvCandidates.length === 1) {
    [file] = csvCandidates;
    method = 'csv_name';
  } else if (csvCandidates.length > 1) {
    file = [...csvCandidates].sort((a, b) => mtime(b) - mtime(a))[0];
    method = 'csv_name_latest';
  }

  entries.push({
    slug,
    title: r['Название вина'],
    winery: r['Винодельня'],
    category: r['Категория'],
    hue: r['Цвет'],
    region: r['Регион'],
    grapes: r['Сорт винограда'],
    photo_name: photo,
    image: file ? `${relUploads}/${file}` : null,
    match_method: method,
    csv_candidates: csvCandidates.length,
    // База и имя из CSV указывают на один файл — перекрёстная проверка метода csv_name.
    db_csv_agree: dbHit ? csvCandidates.includes(dbHit) : null,
    in_db: dbFileBySlug.has(slug),
  });
}

// Одно фото на несколько слагов: визуально такие вина неразличимы, Top-1 между ними — лотерея.
const slugsByPhoto = new Map();
for (const e of entries) {
  if (!e.image) continue;
  if (!slugsByPhoto.has(e.image)) slugsByPhoto.set(e.image, []);
  slugsByPhoto.get(e.image).push(e.slug);
}
const sharedImages = [...slugsByPhoto].filter(([, s]) => s.length > 1).map(([image, slugs]) => ({ image, slugs }));
const sharedSet = new Set(sharedImages.flatMap((x) => x.slugs));
for (const e of entries) e.shared_image = sharedSet.has(e.slug);

const count = (pred) => entries.filter(pred).length;
const withDb = entries.filter((e) => e.db_csv_agree !== null);
const report = {
  csv_rows: rows.length,
  slugs: entries.length,
  csv_conflicting_duplicates: conflicts,
  matched: count((e) => e.image),
  by_method: Object.fromEntries(['db', 'csv_name', 'csv_name_latest'].map((m) => [m, count((e) => e.match_method === m)])),
  unmatched: entries.filter((e) => !e.image).map((e) => ({ slug: e.slug, photo_name: e.photo_name, in_db: e.in_db })),
  db_csv_cross_check: {
    checked: withDb.length,
    agree: withDb.filter((e) => e.db_csv_agree).length,
    disagree: withDb.filter((e) => !e.db_csv_agree).map((e) => ({ slug: e.slug, photo_name: e.photo_name, image: e.image, csv_candidates: e.csv_candidates })),
  },
  ambiguous_latest: entries.filter((e) => e.match_method === 'csv_name_latest').map((e) => ({ slug: e.slug, photo_name: e.photo_name, candidates: e.csv_candidates })),
  shared_images: sharedImages,
};

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'catalog.jsonl'), entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
fs.writeFileSync(path.join(outDir, 'manifest-report.json'), JSON.stringify(report, null, 2));

console.log(JSON.stringify({
  slugs: report.slugs,
  matched: report.matched,
  by_method: report.by_method,
  unmatched: report.unmatched.length,
  csv_conflicting_duplicates: conflicts.length,
  db_csv_agree: `${report.db_csv_cross_check.agree}/${report.db_csv_cross_check.checked}`,
  shared_images: sharedImages.length,
  slugs_on_shared_images: sharedSet.size,
}, null, 2));
console.log(`→ ${path.relative(projectRoot, outDir)}/catalog.jsonl, manifest-report.json`);
