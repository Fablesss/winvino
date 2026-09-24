// Артефакты модели в репозиторий: файлы бандла (ml/export_bundle.py) кладутся в artifacts/
// как обычные файлы git, а то, что не проходит лимит GitHub в 100 МиБ на файл, режется на части.
// Образ распознавателя склеивает части при сборке (deploy/recognizer.Dockerfile).
//
//   node scripts/bundle-to-repo.mjs
//   node scripts/bundle-to-repo.mjs --manifest data/raw/deploy/bundle.json --out artifacts --part-mb 90
//
// Источник файлов — тот же WINVINO_DATA_DIR, из которого собирался бандл: манифест хранит пути
// относительно него и sha256 каждого файла, и они здесь сверяются — так в репозиторий не уедет
// чекпойнт, переписанный после экспорта.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = path.resolve(process.env.WINVINO_DATA_DIR || path.join(ROOT, 'data', 'raw'));
const MANIFEST = path.resolve(arg('manifest', path.join(DATA_DIR, 'deploy', 'bundle.json')));
const OUT_DIR = path.resolve(arg('out', path.join(ROOT, 'artifacts')));
const PART_BYTES = Number(arg('part-mb', 90)) * 2 ** 20;
// Жёсткий лимит GitHub на файл в обычном git; выше 50 МиБ — только предупреждение при push.
const GITHUB_LIMIT = 100 * 2 ** 20;
const SUMS_NAME = 'bundle.sha256sums';

const sha256 = (file) => new Promise((resolve, reject) => {
  const h = crypto.createHash('sha256');
  fs.createReadStream(file).on('error', reject).on('data', (c) => h.update(c)).on('end', () => resolve(h.digest('hex')));
});

/** Файл целиком или пронумерованными частями `<имя>.partNN`; возвращает имена записанного. */
function writeParts(src, dest, size) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (size <= PART_BYTES) {
    fs.copyFileSync(src, dest);
    return [path.basename(dest)];
  }
  const fd = fs.openSync(src, 'r');
  const buf = Buffer.allocUnsafe(PART_BYTES);
  const names = [];
  try {
    for (let offset = 0, n = 0; offset < size; n += 1) {
      const read = fs.readSync(fd, buf, 0, PART_BYTES, offset);
      const name = `${path.basename(dest)}.part${String(n).padStart(2, '0')}`;
      fs.writeFileSync(path.join(path.dirname(dest), name), buf.subarray(0, read));
      names.push(name);
      offset += read;
    }
  } finally {
    fs.closeSync(fd);
  }
  return names;
}

const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
const entries = Object.entries(manifest.files);
if (!entries.length) throw new Error(`в манифесте ${MANIFEST} нет файлов`);

// Старую раскладку сносим целиком: при смене тега имена чекпойнта и индекса меняются,
// и оставшиеся файлы уехали бы в образ мусором.
for (const stale of ['dataset', 'model', 'bundle.json', SUMS_NAME]) {
  fs.rmSync(path.join(OUT_DIR, stale), { recursive: true, force: true });
}

const written = [];
for (const [rel, digest] of entries) {
  const src = path.join(DATA_DIR, ...rel.split('/'));
  const actual = await sha256(src);
  if (actual !== digest) throw new Error(`${rel}: sha256 ${actual} не совпал с манифестом ${digest} — пересоберите бандл`);
  const size = fs.statSync(src).size;
  const names = writeParts(src, path.join(OUT_DIR, ...rel.split('/')), size);
  written.push({ rel, mb: +(size / 2 ** 20).toFixed(1), parts: names.length });
  const partBytes = names.length > 1 ? PART_BYTES : size;
  if (partBytes > GITHUB_LIMIT) throw new Error(`${rel}: часть ${partBytes} Б больше лимита GitHub — уменьшите --part-mb`);
}

fs.copyFileSync(MANIFEST, path.join(OUT_DIR, 'bundle.json'));
// Тот же манифест в формате sha256sum: сборка образа сверяет склеенные файлы одной командой.
fs.writeFileSync(path.join(OUT_DIR, SUMS_NAME), entries.map(([rel, d]) => `${d}  ${rel}`).join('\n') + '\n');

console.log(JSON.stringify({
  tag: manifest.tag,
  out: path.relative(ROOT, OUT_DIR).replaceAll('\\', '/'),
  partMb: PART_BYTES / 2 ** 20,
  files: written,
}, null, 1));
