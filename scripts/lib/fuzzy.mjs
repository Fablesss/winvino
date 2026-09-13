// Токенное сходство для матчинга OCR с каталогом.
//
// Почему не сравнение строк целиком: OCR отдаёт шумный блоб
// («| | / Л / ОЛ о Высокий БЕРЕГ ЦВАЙГЕЛЬТ \ ...»), в котором название занимает малую
// долю, и similarity() по всей строке его топит. Работаем по отдельным токенам.

/**
 * Нормализация. ДОЛЖНА совпадать с public.norm_label() в миграции
 * 20260913071708_WIN-1_system_create_extensions.sql — паритет проверяется
 * scripts/check-norm-parity.mjs на всех 2041 названии.
 */
export const normLabel = (s) => (s ?? '')
  .toLowerCase()
  .replace(/ё/g, 'е')
  .replace(/[ъь]/g, '')
  .replace(/[^a-zа-я0-9]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

export const tokenize = (norm) => (norm ? norm.split(' ').filter((t) => t.length >= 2) : []);

const TRANSLIT = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ж: 'zh', з: 'z', и: 'i', й: 'j',
  к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f',
  х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sh', ы: 'y', э: 'e', ю: 'yu', я: 'ya',
};

/**
 * Кириллица -> латиница, чтобы сравнивать написания в разных алфавитах.
 * Без этого «MADRASA» с этикетки и «Мадраса» из каталога имеют сходство РОВНО 0:
 * у разных алфавитов нет ни одной общей триграммы. В каталоге 1344 названия только
 * кириллицей и 397 только латиницей, а на этикетке алфавит непредсказуем.
 * Схема нарочно упрощена (ц->c, щ->sh): цель не обратимость, а встреча двух написаний
 * в одном пространстве.
 */
export const translit = (s) => [...(s ?? '')].map((ch) => TRANSLIT[ch] ?? ch).join('');

/** Триграммы с паддингом по краям, как в pg_trgm. */
export function trigrams(str) {
  const s = `  ${str} `;
  const out = new Set();
  for (let i = 0; i + 3 <= s.length; i += 1) out.add(s.slice(i, i + 3));
  return out;
}

/** Жаккар по триграммам: 0..1. */
export function trigramSimilarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const A = trigrams(a);
  const B = trigrams(b);
  let shared = 0;
  for (const g of A) if (B.has(g)) shared += 1;
  return shared / (A.size + B.size - shared);
}

/**
 * Для каждого токена словаря — лучшее сходство с любым токеном OCR.
 * Считается один раз на скан: словарь ~3-4 тысячи токенов против ~30 токенов OCR.
 * Дальше оценка любого из 2041 вина сводится к выборкам из этой карты.
 */
const jaccard = (A, B) => {
  let shared = 0;
  for (const g of A) if (B.has(g)) shared += 1;
  return shared / (A.size + B.size - shared);
};

/** Триграммы слова в двух пространствах: как есть и в транслите. */
export const gramsOf = (token) => ({ g: trigrams(token), t: trigrams(translit(token)) });

export function scoreVocabulary(ocrTokens, vocab, minSim = 0.55) {
  const ocr = ocrTokens.map((tok) => ({ tok, ...gramsOf(tok) }));
  const scores = new Map();
  for (const [token, grams] of vocab) {
    let best = 0;
    for (const o of ocr) {
      if (token === o.tok) { best = 1; break; }
      // max по двум пространствам: кириллица против латиницы иначе даёт 0.
      const sim = Math.max(jaccard(grams.g, o.g), jaccard(grams.t, o.t));
      if (sim > best) best = sim;
    }
    if (best >= minSim) scores.set(token, best);
  }
  return scores;
}

/**
 * Доля токенов needle, покрытая OCR, с весом по редкости токена.
 * Без IDF «Каберне Совиньон» и «Губернаторское Каберне» набирают одинаково, когда на
 * этикетке напечатаны и сорт, и собственное имя вина. Различает их то, что
 * «губернаторское» редкое, а «каберне» встречается в сотнях названий.
 */
export function weightedCoverage(needleTokens, tokenScores, idf) {
  return coverageAndMass(needleTokens, tokenScores, idf).coverage;
}

/**
 * Покрытие И абсолютная масса совпавших редких токенов.
 * Одного покрытия недостаточно: оно нормируется на длину названия, поэтому короткое
 * название набирает единицу дёшево — «Rose» одним словом получал 1.0 и обходил
 * «Abrau Estates Амурский Потапенко». Замер это подтвердил: победитель оказывался
 * короче эталона в 31 случае против 13. Масса добавляет обратный вес: длинное
 * название с редкими словами, прочитанное частично, всё равно весит больше.
 */
export function coverageAndMass(needleTokens, tokenScores, idf) {
  let num = 0;
  let den = 0;
  for (const t of needleTokens) {
    const w = idf(t);
    den += w;
    num += w * (tokenScores.get(t) ?? 0);
  }
  return { coverage: den ? num / den : 0, mass: num };
}

/** Смесь покрытия и массы. massRef — масштаб, отбивающий «дешёвые» короткие совпадения. */
export function blendedScore({ coverage, mass }, massRef) {
  return 0.5 * coverage + 0.5 * (mass / (mass + massRef));
}

/** ln(1 + N/df): частые токены почти не весят, редкие весят много. */
export function makeIdf(dfByToken, totalDocs) {
  const fallback = Math.log(1 + totalDocs);
  return (token) => {
    const df = dfByToken.get(token);
    return df ? Math.log(1 + totalDocs / df) : fallback;
  };
}
