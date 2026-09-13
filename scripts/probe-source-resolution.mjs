// Read-only: истинное разрешение оригиналов в хранилище каталога.
// resize с большим боксом не апскейлит, поэтому отдаёт исходный размер как есть.
import sharp from 'sharp';
import { connect } from './lib/db.mjs';

// 1600 — в пределах допустимого (4000 отдаёт 400), при этом resize не апскейлит,
// поэтому для любого оригинала меньше 1600px вернётся его настоящий размер.
const BASE = 'https://api.vino-svoe.ru/v1/img/str-api/1600/1600/resize';
const HEADERS = { 'User-Agent': 'winvino-probe/0.1', Referer: 'https://vino-svoe.ru/' };
const SAMPLE = 60;

const client = await connect();
let rows;
try {
  ({ rows } = await client.query(
    'SELECT slug, image_url FROM wines ORDER BY random() LIMIT $1', [SAMPLE],
  ));
} finally {
  await client.end();
}

const sizes = [];
for (const r of rows) {
  try {
    const res = await fetch(`${BASE}${r.image_url}`, { headers: HEADERS });
    if (!res.ok) { console.log(`  HTTP ${res.status} ${r.slug}`); continue; }
    const m = await sharp(Buffer.from(await res.arrayBuffer())).metadata();
    sizes.push({ w: m.width, h: m.height, px: m.width * m.height, slug: r.slug });
  } catch (err) {
    console.log(`  ошибка ${r.slug}: ${err.message}`);
  }
}

const byDim = new Map();
for (const s of sizes) {
  const k = `${s.w}x${s.h}`;
  byDim.set(k, (byDim.get(k) ?? 0) + 1);
}
console.log(`\nпроверено оригиналов: ${sizes.length}`);
console.log('\nразмеры (сколько раз встретился):');
for (const [dim, n] of [...byDim].sort((a, b) => b[1] - a[1])) console.log(`  ${dim.padEnd(12)} ${n}`);

const widths = sizes.map((s) => s.w).sort((a, b) => a - b);
const heights = sizes.map((s) => s.h).sort((a, b) => a - b);
const q = (arr, p) => arr[Math.floor((arr.length - 1) * p)];
console.log(`\nширина : min=${widths[0]} p50=${q(widths, 0.5)} p90=${q(widths, 0.9)} max=${widths.at(-1)}`);
console.log(`высота : min=${heights[0]} p50=${q(heights, 0.5)} p90=${q(heights, 0.9)} max=${heights.at(-1)}`);
console.log('\nсамые крупные:');
for (const s of [...sizes].sort((a, b) => b.px - a.px).slice(0, 5)) {
  console.log(`  ${s.w}x${s.h}  ${s.slug}`);
}
