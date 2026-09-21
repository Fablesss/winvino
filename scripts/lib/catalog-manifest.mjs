// Индекс матчера из манифеста датасета (data/raw/dataset/catalog.jsonl) — без базы.
//
// Каталог организатора — CSV-выгрузка Strapi (2103 слага), в зеркале базы из них 2037.
// Сервис распознавания должен знать все 2103 и не падать, когда база недоступна.
import fs from 'node:fs';
import slugify from '@sindresorhus/slugify';
import { normLabel } from './fuzzy.mjs';
import { buildIndex } from './matcher.mjs';

export function readManifest(path) {
  return fs.readFileSync(path, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
}

// Порядок важен: «экстра брют» раньше «брют». Сравнение по целым токенам слага,
// поэтому «suhoe» не срабатывает внутри «polusuhoe».
const SWEETNESS_BY_SLUG = [
  [['ekstra', 'bryut'], 'экстра брют'],
  [['bryut'], 'брют'],
  [['polusuhoe'], 'полусухое'],
  [['polusladkoe'], 'полусладкое'],
  [['suhoe'], 'сухое'],
  [['sladkoe'], 'сладкое'],
];

/** Сладость из слага вина: в CSV отдельного поля нет, а в слаге она почти всегда есть. */
export function sweetnessOf(slug) {
  const tokens = slug.split('-');
  for (const [need, value] of SWEETNESS_BY_SLUG) {
    const i = tokens.indexOf(need[0]);
    if (i >= 0 && need.every((t, k) => tokens[i + k] === t)) return value;
  }
  return null;
}

export function indexFromManifest(entries) {
  const wineries = new Map();
  for (const e of entries) {
    if (wineries.has(e.winery)) continue;
    wineries.set(e.winery, {
      id: e.winery,
      name: e.winery,
      name_norm: normLabel(e.winery),
      // Латинское написание винодельни: этикетки часто печатают бренд латиницей.
      slug_norm: normLabel(slugify(e.winery).replace(/-/g, ' ')),
    });
  }
  const wines = entries.map((e) => ({
    id: e.slug,
    slug: e.slug,
    title: e.title,
    title_norm: normLabel(e.title),
    slug_norm: normLabel(e.slug.replace(/-/g, ' ')),
    manufacturer_id: e.winery,
    wine_color: e.category,
    sweetness: sweetnessOf(e.slug),
  }));
  return buildIndex([...wineries.values()], wines);
}
