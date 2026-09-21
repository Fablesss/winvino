// Матчер этикетки: OCR-текст -> ранжированные кандидаты из каталога.
//
// Схема из трёх ступеней. Название вина НЕ идентификатор («Рислинг» = 37 разных вин),
// поэтому первичный сигнал — винодельня:
//   A. винодельня по названию и латинскому слагу;
//   B. вино внутри портфеля (медиана 8 вин, у крупных до 101);
//   C. цвет и сахар — они напечатаны на этикетке и разводят 69 коллизий вида
//      «производитель + название».
//
// Индекс каталога (2041 вино, 374 КБ) держим в памяти: он мал, а матчинг требует
// сравнения со ВСЕМИ кандидатами, что в SQL означало бы полный проход на каждый скан.
// Триграммные GIN-индексы в базе остаются рабочим инструментом для SQL-пути поиска.
import {
  blendedScore, coverageAndMass, expandAliases, foldGreek, gramsOf, makeIdf, normLabel, scoreVocabulary, tokenize,
} from './fuzzy.mjs';

export const MATCHER_VERSION = 'idf-mass-translit-skeleton-alias-v5';

/** Веса финального счёта. Подбирать по eval-набору, а не на глаз. */
const W_WINERY = 0.40;
const W_TITLE = 0.50;
const W_CATEGORY = 0.10;

/** Загружает каталог из зеркала в базе. */
export async function loadIndex(client) {
  const { rows: wineries } = await client.query(
    'SELECT id, name, name_norm, slug_norm FROM manufacturers',
  );
  const { rows: wines } = await client.query(`
    SELECT w.id, w.slug, w.title, w.title_norm, w.slug_norm, w.manufacturer_id,
           w.wine_color, w.sweetness, w.category_name, w.public_rating
    FROM wines w`);
  return buildIndex(wineries, wines);
}

/**
 * Индекс из готовых строк — всё, что считается один раз, а не на каждый скан.
 * wineries: {id, name, name_norm, slug_norm}; wines: {id, slug, title, title_norm,
 * slug_norm, manufacturer_id, wine_color, sweetness}. Источник — база (`loadIndex`)
 * или манифест датасета (`scripts/lib/catalog-manifest.mjs`).
 */
export function buildIndex(wineries, wines) {
  const df = (docs, pick) => {
    const map = new Map();
    for (const d of docs) {
      for (const t of new Set(tokenize(pick(d)))) map.set(t, (map.get(t) ?? 0) + 1);
    }
    return map;
  };
  const idfTitle = makeIdf(df(wines, (w) => w.title_norm), wines.length);
  const idfWinery = makeIdf(df(wineries, (w) => w.name_norm), wineries.length);

  for (const w of wineries) {
    w.nameTokens = tokenize(w.name_norm);
    w.slugTokens = tokenize(w.slug_norm);
  }
  for (const w of wines) {
    w.titleTokens = tokenize(w.title_norm);
    w.slugTokens = tokenize(w.slug_norm);
    w.colorNorm = normLabel(w.wine_color);
    w.sweetNorm = normLabel(w.sweetness);
  }

  // Словарь всех токенов каталога с предпосчитанными триграммами в двух алфавитах.
  const vocab = new Map();
  const add = (tokens) => { for (const t of tokens) if (!vocab.has(t)) vocab.set(t, gramsOf(t)); };
  for (const w of wineries) { add(w.nameTokens); add(w.slugTokens); }
  for (const w of wines) {
    add(w.titleTokens); add(w.slugTokens);
    add(tokenize(w.colorNorm)); add(tokenize(w.sweetNorm));
  }

  // Масштаб для смеси покрытия и массы — медиана суммарного idf названия.
  const median = (xs) => {
    const s = [...xs].sort((a, b) => a - b);
    return s.length ? s[Math.floor(s.length / 2)] : 1;
  };
  const massOf = (tokens, idf) => tokens.reduce((acc, t) => acc + idf(t), 0);
  const massRefTitle = median(wines.map((w) => massOf(w.titleTokens, idfTitle))) || 1;
  const massRefWinery = median(wineries.map((w) => massOf(w.nameTokens, idfWinery))) || 1;

  const wineryById = new Map(wineries.map((w) => [w.id, w]));
  return { wines, wineries, wineryById, vocab, idfTitle, idfWinery, massRefTitle, massRefWinery };
}

/**
 * Ранжирует каталог по OCR-тексту.
 * @returns {{ocrNorm: string, wineries: Array, candidates: Array}}
 */
export function matchLabel(index, ocrText, { limit = 5, truthSlug = null } = {}) {
  // Греческие двойники сворачиваются до нормализации, иначе она выбросит их как мусор.
  const ocrNorm = normLabel(foldGreek(ocrText));
  const ocrTokens = expandAliases(tokenize(ocrNorm));
  if (!ocrTokens.length) {
    return { ocrNorm, wineries: [], candidates: [], truth: truthSlug ? { rank: null } : null };
  }

  const tokenScores = scoreVocabulary(ocrTokens, index.vocab);

  // Ступень A
  const wineryScore = new Map();
  for (const w of index.wineries) {
    const byName = blendedScore(coverageAndMass(w.nameTokens, tokenScores, index.idfWinery), index.massRefWinery);
    const bySlug = blendedScore(coverageAndMass(w.slugTokens, tokenScores, index.idfWinery), index.massRefWinery);
    wineryScore.set(w.id, Math.max(byName, bySlug));
  }
  const topWineries = [...index.wineries]
    .map((w) => ({ id: w.id, name: w.name, score: Number(wineryScore.get(w.id).toFixed(3)) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  // Ступени B и C
  const candidates = index.wines.map((w) => {
    const byTitle = blendedScore(coverageAndMass(w.titleTokens, tokenScores, index.idfTitle), index.massRefTitle);
    const bySlug = blendedScore(coverageAndMass(w.slugTokens, tokenScores, index.idfTitle), index.massRefTitle);
    const title = Math.max(byTitle, bySlug);
    const winery = wineryScore.get(w.manufacturer_id) ?? 0;
    const colorHit = w.colorNorm && ocrTokens.includes(w.colorNorm) ? 1 : 0;
    const sweetHit = w.sweetNorm && tokenize(w.sweetNorm).every((t) => ocrTokens.includes(t)) ? 1 : 0;
    const category = (colorHit + sweetHit) / 2;
    return {
      slug: w.slug,
      title: w.title,
      winery_name: index.wineryById.get(w.manufacturer_id)?.name ?? null,
      winery_score: Number(winery.toFixed(3)),
      title_score: Number(title.toFixed(3)),
      category_score: category,
      score: Number((W_WINERY * winery + W_TITLE * title + W_CATEGORY * category).toFixed(4)),
    };
  });

  candidates.sort((a, b) => b.score - a.score || a.slug.localeCompare(b.slug));

  // Диагностика по эталону: позиция правильного ответа во ВСЕЙ выдаче и его покрытия
  // по отдельности. Без этого нельзя отличить «OCR не прочёл этикетку» от
  // «прочёл, но матчер отранжировал неверно».
  let truth = null;
  if (truthSlug) {
    const i = candidates.findIndex((c) => c.slug === truthSlug);
    const row = i >= 0 ? candidates[i] : null;
    truth = {
      rank: i >= 0 ? i + 1 : null,
      winery_score: row?.winery_score ?? null,
      title_score: row?.title_score ?? null,
      score: row?.score ?? null,
    };
  }

  return { ocrNorm, wineries: topWineries, candidates: candidates.slice(0, limit), truth };
}
