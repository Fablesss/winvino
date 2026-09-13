// Read-only: почему у части вин нет manufacturer_id. Сверяет базу с живым API.
import { connect } from './lib/db.mjs';

const API = process.env.VINO_API_BASE ?? 'https://api.vino-svoe.ru/v1';
const client = await connect();
try {
  const { rows } = await client.query(
    'SELECT slug, title FROM wines WHERE manufacturer_id IS NULL ORDER BY slug',
  );
  console.log(`вин без винодельни: ${rows.length}\n`);

  for (const w of rows) {
    const d = await fetch(`${API}/wines/${encodeURIComponent(w.slug)}`, {
      headers: { 'User-Agent': 'winvino-diagnose/0.1', Referer: 'https://vino-svoe.ru/' },
    }).then((r) => r.json());
    console.log(`${w.slug}`);
    console.log(`  title              : ${w.title}`);
    console.log(`  detail.manufacturer: ${JSON.stringify(d.manufacturer ?? null)}`);
  }

  // Что отдаёт список для этих же вин — там производитель строкой.
  const slugs = new Set(rows.map((r) => r.slug));
  const listNames = new Map();
  for (let page = 1; page <= 69 && listNames.size < slugs.size; page += 1) {
    const j = await fetch(`${API}/wines?page=${page}&perPage=30`, {
      headers: { 'User-Agent': 'winvino-diagnose/0.1', Referer: 'https://vino-svoe.ru/' },
    }).then((r) => r.json());
    for (const item of j.items) if (slugs.has(item.slug)) listNames.set(item.slug, item.manufacturer);
  }
  console.log('\nчто говорит список (поле manufacturer строкой):');
  for (const [slug, name] of listNames) console.log(`  ${slug} -> ${JSON.stringify(name)}`);

  const names = [...new Set([...listNames.values()].filter(Boolean))];
  if (names.length) {
    const { rows: near } = await client.query(
      `SELECT $1::text AS probe, name, slug, round(similarity(name_norm, public.norm_label($1))::numeric,3) AS score
       FROM manufacturers ORDER BY score DESC LIMIT 3`,
      [names[0]],
    );
    console.log(`\nближайшие в справочнике к «${names[0]}»:`);
    console.log(near);
  }
} finally {
  await client.end();
}
