// Read-only разведка: какой самый крупный рендер отдаёт картиночный прокси
// и что реально означает глагол fit против resize.
import sharp from 'sharp';

const FILE = 'priboj_Marchenko_beloe_no_bg_preview_carve_photos_de18758756.webp';
const BASE = 'https://api.vino-svoe.ru/v1/img/str-api';
const HEADERS = { 'User-Agent': 'winvino-probe/0.1', Referer: 'https://vino-svoe.ru/' };

const probe = async (verb, w, h) => {
  const url = `${BASE}/${w}/${h}/${verb}/uploads/${FILE}`;
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) return console.log(`  ${verb} ${w}x${h} -> HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const m = await sharp(buf).metadata();
  console.log(
    `  ${verb.padEnd(6)} ${String(w).padStart(4)}x${String(h).padEnd(4)}`
    + ` -> ${m.width}x${m.height} ${m.format} alpha=${m.hasAlpha} ${buf.length} байт`,
  );
};

console.log('=== resize ===');
for (const s of [340, 910, 1600]) await probe('resize', s, s);

console.log('=== fit ===');
for (const s of [340, 910, 1600, 2400]) await probe('fit', s, s);

console.log('=== fit, неквадратный запрос ===');
await probe('fit', 1200, 3000);
await probe('fit', 3000, 3000);
