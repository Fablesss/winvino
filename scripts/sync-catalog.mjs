// Синхронизация зеркала каталога vino-svoe.ru в Postgres.
// Идемпотентно: гоняется повторно, обновляет существующие строки по slug.
//   node scripts/sync-catalog.mjs             полная синхронизация (список + детали)
//   node scripts/sync-catalog.mjs --no-detail только список (быстро, без grapes/dishes)
//   node scripts/sync-catalog.mjs --limit 50  первые N вин — для отладки
//
// Запись идёт пакетами через unnest(): база удалённая, каждый round-trip ~40 мс,
// поэтому построчные upsert'ы справочников превращали синхронизацию в десять минут.
import { connect } from './lib/db.mjs';

const API = process.env.VINO_API_BASE ?? 'https://api.vino-svoe.ru/v1';
const PER_PAGE = 30;        // максимум, который принимает API: 31+ отдаёт 400
const DETAIL_CONCURRENCY = 4;

const argv = process.argv.slice(2);
const skipDetail = argv.includes('--no-detail');
const limitArg = argv.indexOf('--limit');
const limit = limitArg >= 0 ? Number(argv[limitArg + 1]) : Infinity;

const HEADERS = {
  'User-Agent': 'winvino-catalog-sync/0.1',
  Referer: 'https://vino-svoe.ru/',
  Accept: 'application/json',
};

async function getJson(url, attempt = 1) {
  try {
    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    if (attempt >= 3) throw new Error(`${url}: ${err.message}`);
    await new Promise((r) => setTimeout(r, 500 * attempt));
    return getJson(url, attempt + 1);
  }
}

/** «Белое полусухое» → { wineColor: 'Белое', sweetness: 'полусухое' } */
function splitCategory(category) {
  if (!category) return { wineColor: null, sweetness: null };
  const i = category.indexOf(' ');
  if (i < 0) return { wineColor: category, sweetness: null };
  return { wineColor: category.slice(0, i), sweetness: category.slice(i + 1).trim() || null };
}

// Транслитерация для случая, когда API не дал слаг производителя.
const TRANSLIT = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'j',
  к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f',
  х: 'h', ц: 'cz', ч: 'ch', ш: 'sh', щ: 'shh', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};

/**
 * Слаг в стиле API. Нужен для 3 виноделен, у которых /wines/{slug} отдаёт
 * manufacturer без slug, а в /manufacturers их нет вообще («Поместье Голубицкое»,
 * «Mancopia», «Wein und Wasser») — без этого их 9 вин остаются без винодельни,
 * а название винодельни у нас главный сигнал матчера.
 */
function slugify(name) {
  return [...name.toLowerCase()]
    .map((ch) => TRANSLIT[ch] ?? ch)
    .join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Год есть только у ~112 названий из 2041 — отсутствие это норма, а не недогруз. */
function parseVintage(title) {
  const m = /\b(19|20)\d{2}\b/.exec(title ?? '');
  return m ? Number(m[0]) : null;
}

async function fetchList() {
  const items = [];
  let page = 1;
  let totalPages = 1;
  do {
    const j = await getJson(`${API}/wines?page=${page}&perPage=${PER_PAGE}`);
    totalPages = j.totalPages;
    items.push(...j.items);
    if (page === 1) console.log(`каталог: totalItems=${j.totalItems} totalPages=${j.totalPages}`);
    page += 1;
  } while (page <= totalPages && items.length < limit);
  return limit === Infinity ? items : items.slice(0, limit);
}

/** Детали — с ограниченным параллелизмом: чужой сервер, грузить его незачем. */
async function fetchDetails(slugs) {
  const out = new Map();
  const queue = [...slugs];
  let done = 0;
  await Promise.all(
    Array.from({ length: DETAIL_CONCURRENCY }, async () => {
      while (queue.length) {
        const slug = queue.shift();
        try {
          out.set(slug, await getJson(`${API}/wines/${encodeURIComponent(slug)}`));
        } catch (err) {
          console.warn(`  деталь не получена: ${slug} — ${err.message}`);
        }
        if (++done % 250 === 0) console.log(`  детали: ${done}/${slugs.length}`);
      }
    }),
  );
  return out;
}

/** Колонки массивами: транспонируем строки в массив-на-колонку для unnest(). */
const columnsOf = (rows, keys) => keys.map((k) => rows.map((r) => r[k] ?? null));

const client = await connect();
try {
  console.log('--- список ---');
  const list = await fetchList();
  console.log(`получено записей: ${list.length}`);

  console.log('--- производители (латинские слаги) ---');
  const mfrRef = (await getJson(`${API}/manufacturers`)).flatMap((g) => g.items);
  console.log(`в справочнике: ${mfrRef.length}`);

  let details = new Map();
  if (!skipDetail) {
    console.log('--- детали ---');
    details = await fetchDetails(list.map((w) => w.slug));
    console.log(`деталей получено: ${details.size}/${list.length}`);
  }

  console.log('--- запись в базу ---');
  const t0 = Date.now();
  await client.query('BEGIN');

  // --- производители ---------------------------------------------------------
  const mfrByslug = new Map(mfrRef.map((m) => [m.slug, m.name]));
  const refNames = new Set(mfrRef.map((m) => m.name));
  const derived = [];
  for (const d of details.values()) {
    const m = d?.manufacturer;
    if (!m?.name) continue;
    if (m.slug) {
      mfrByslug.set(m.slug, m.name);
    } else if (!refNames.has(m.name) && !mfrByslug.has(slugify(m.name))) {
      mfrByslug.set(slugify(m.name), m.name);
      derived.push(m.name);
    }
  }
  if (derived.length) console.log(`слаг сгенерирован локально для: ${derived.join(', ')}`);
  const mfrRows = [...mfrByslug].map(([slug, name]) => ({ slug, name }));
  await client.query(
    `INSERT INTO manufacturers (slug, name)
     SELECT * FROM unnest($1::text[], $2::text[])
     ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, updated_at = now()`,
    columnsOf(mfrRows, ['slug', 'name']),
  );

  // --- справочники: собираем уникальные значения и пишем по одному запросу ----
  const regions = new Map();   // name -> image_url
  const grapes = new Map();    // name -> { image_url, background_image_url }
  const dishes = new Map();    // name -> image_url
  const keepFirst = (map, key, value) => {
    if (!key) return;
    if (!map.has(key) || (map.get(key) == null && value != null)) map.set(key, value);
  };

  for (const w of list) keepFirst(regions, w.region, null);
  for (const d of details.values()) {
    if (d?.region?.name) regions.set(d.region.name, d.region.image?.url ?? regions.get(d.region.name) ?? null);
    for (const g of d?.grapes ?? []) {
      grapes.set(g.name, {
        image_url: g.image?.url ?? grapes.get(g.name)?.image_url ?? null,
        background_image_url: g.backgroundImage?.url ?? grapes.get(g.name)?.background_image_url ?? null,
      });
    }
    for (const dish of d?.dishes ?? []) keepFirst(dishes, dish.name, dish.image?.url ?? null);
  }

  await client.query(
    `INSERT INTO regions (name, image_url)
     SELECT * FROM unnest($1::text[], $2::text[])
     ON CONFLICT (name) DO UPDATE SET image_url = COALESCE(EXCLUDED.image_url, regions.image_url)`,
    [[...regions.keys()], [...regions.values()]],
  );
  await client.query(
    `INSERT INTO grapes (name, image_url, background_image_url)
     SELECT * FROM unnest($1::text[], $2::text[], $3::text[])
     ON CONFLICT (name) DO UPDATE SET
       image_url            = COALESCE(EXCLUDED.image_url, grapes.image_url),
       background_image_url = COALESCE(EXCLUDED.background_image_url, grapes.background_image_url)`,
    [
      [...grapes.keys()],
      [...grapes.values()].map((v) => v.image_url),
      [...grapes.values()].map((v) => v.background_image_url),
    ],
  );
  await client.query(
    `INSERT INTO dishes (name, image_url)
     SELECT * FROM unnest($1::text[], $2::text[])
     ON CONFLICT (name) DO UPDATE SET image_url = COALESCE(EXCLUDED.image_url, dishes.image_url)`,
    [[...dishes.keys()], [...dishes.values()]],
  );

  const idMap = async (table) =>
    new Map((await client.query(`SELECT id, name FROM ${table}`)).rows.map((r) => [r.name, r.id]));
  const mfrIdBySlug = new Map(
    (await client.query('SELECT id, slug FROM manufacturers')).rows.map((r) => [r.slug, r.id]),
  );
  const mfrIdByName = new Map(
    (await client.query('SELECT id, name FROM manufacturers')).rows.map((r) => [r.name, r.id]),
  );
  const regionId = await idMap('regions');
  const grapeId = await idMap('grapes');
  const dishId = await idMap('dishes');

  // --- вина ------------------------------------------------------------------
  const now = new Date();
  const wineRows = list.map((w) => {
    const d = details.get(w.slug);
    const category = d?.category?.name ?? w.category ?? null;
    const { wineColor, sweetness } = splitCategory(category);
    return {
      slug: w.slug,
      title: w.title,
      manufacturer_id:
        (d?.manufacturer?.slug ? mfrIdBySlug.get(d.manufacturer.slug) : null)
        ?? mfrIdByName.get(w.manufacturer) ?? null,
      region_id: regionId.get(d?.region?.name ?? w.region) ?? null,
      category_name: category,
      wine_color: wineColor,
      sweetness,
      hue: d?.color ?? w.color ?? null,
      public_rating: w.publicRating ?? d?.publicRating ?? null,
      alcohol: d?.alcohol ?? null,
      serve_temperature: d?.temperature ?? null,
      description: d?.description ?? null,
      image_url: (d?.image?.url ?? w.image?.url) ?? null,
      vintage: parseVintage(w.title),
      detail_synced_at: d ? now : null,
    };
  });

  const wineKeys = [
    'slug', 'title', 'manufacturer_id', 'region_id', 'category_name', 'wine_color', 'sweetness',
    'hue', 'public_rating', 'alcohol', 'serve_temperature', 'description', 'image_url',
    'vintage', 'detail_synced_at',
  ];
  await client.query(
    `INSERT INTO wines (${wineKeys.join(', ')})
     SELECT * FROM unnest($1::text[],$2::text[],$3::uuid[],$4::uuid[],$5::text[],$6::text[],
                          $7::text[],$8::text[],$9::numeric[],$10::numeric[],$11::text[],
                          $12::text[],$13::text[],$14::smallint[],$15::timestamptz[])
     ON CONFLICT (slug) DO UPDATE SET
       title             = EXCLUDED.title,
       manufacturer_id   = COALESCE(EXCLUDED.manufacturer_id,   wines.manufacturer_id),
       region_id         = COALESCE(EXCLUDED.region_id,         wines.region_id),
       category_name     = COALESCE(EXCLUDED.category_name,     wines.category_name),
       wine_color        = COALESCE(EXCLUDED.wine_color,        wines.wine_color),
       sweetness         = COALESCE(EXCLUDED.sweetness,         wines.sweetness),
       hue               = COALESCE(EXCLUDED.hue,               wines.hue),
       public_rating     = COALESCE(EXCLUDED.public_rating,     wines.public_rating),
       alcohol           = COALESCE(EXCLUDED.alcohol,           wines.alcohol),
       serve_temperature = COALESCE(EXCLUDED.serve_temperature, wines.serve_temperature),
       description       = COALESCE(EXCLUDED.description,       wines.description),
       image_url         = COALESCE(EXCLUDED.image_url,         wines.image_url),
       vintage           = COALESCE(EXCLUDED.vintage,           wines.vintage),
       detail_synced_at  = COALESCE(EXCLUDED.detail_synced_at,  wines.detail_synced_at)`,
    columnsOf(wineRows, wineKeys),
  );

  const wineIdBySlug = new Map(
    (await client.query('SELECT id, slug FROM wines')).rows.map((r) => [r.slug, r.id]),
  );

  // --- фото и связки ---------------------------------------------------------
  const photos = [];
  const wgPairs = [];
  const wdPairs = [];
  for (const w of list) {
    const wineId = wineIdBySlug.get(w.slug);
    if (!wineId) continue;
    const d = details.get(w.slug);
    const url = (d?.image?.url ?? w.image?.url) ?? null;
    if (url) photos.push({ wine_id: wineId, source_url: url, kind: 'catalog_render' });
    for (const g of d?.grapes ?? []) {
      const gid = grapeId.get(g.name);
      if (gid) wgPairs.push({ wine_id: wineId, grape_id: gid });
    }
    for (const dish of d?.dishes ?? []) {
      const did = dishId.get(dish.name);
      if (did) wdPairs.push({ wine_id: wineId, dish_id: did });
    }
  }

  if (photos.length) {
    await client.query(
      `INSERT INTO wine_photos (wine_id, source_url, kind)
       SELECT * FROM unnest($1::uuid[], $2::text[], $3::text[])
       ON CONFLICT (wine_id, source_url) DO NOTHING`,
      columnsOf(photos, ['wine_id', 'source_url', 'kind']),
    );
  }
  if (wgPairs.length) {
    await client.query(
      `INSERT INTO wine_grapes (wine_id, grape_id)
       SELECT * FROM unnest($1::uuid[], $2::uuid[]) ON CONFLICT DO NOTHING`,
      columnsOf(wgPairs, ['wine_id', 'grape_id']),
    );
  }
  if (wdPairs.length) {
    await client.query(
      `INSERT INTO wine_dishes (wine_id, dish_id)
       SELECT * FROM unnest($1::uuid[], $2::uuid[]) ON CONFLICT DO NOTHING`,
      columnsOf(wdPairs, ['wine_id', 'dish_id']),
    );
  }

  await client.query('COMMIT');
  console.log(
    `готово за ${((Date.now() - t0) / 1000).toFixed(1)} с: вин ${wineRows.length}, `
    + `производителей ${mfrRows.length}, регионов ${regions.size}, сортов ${grapes.size}, `
    + `гастропар ${dishes.size}, фото ${photos.length}`,
  );
} catch (err) {
  await client.query('ROLLBACK').catch(() => {});
  console.error('синхронизация упала, изменения откатаны:', err.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
