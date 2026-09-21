// Слияние сигналов: визуальное сходство (SigLIP2) + OCR-матчер → вероятность по кандидатам.
//
// Модель — условный логит: у каждого кандидата линейный счёт w·x, вероятность —
// softmax по кандидатам одного запроса. Обучается на правдоподобие правильного
// кандидата, поэтому p(лидера) — откалиброванная уверенность, а не произвольный скор.
//
// Визуал хорошо находит бренд и дизайн, но путает вина одной серии с одинаковой
// этикеткой («Мускатель белый» и «Мускатель чёрный»). Текст разводит именно их.

export const FEATURES = [
  'vis',        // сходство с референсом
  'vis_gap',    // отставание от лучшего визуального кандидата (≤ 0)
  'vis_logrank',
  'txt',        // итоговый скор матчера
  'txt_gap',    // отставание от лучшего текстового кандидата (≤ 0)
  'txt_winery',
  'txt_title',
  'txt_category',
  'txt_top1',   // кандидат — лидер текстовой выдачи
];

/** Стартовые веса до обучения: только визуал, текст — слабой добавкой. */
export const DEFAULT_WEIGHTS = {
  vis: 40, vis_gap: 0, vis_logrank: 0, txt: 4, txt_gap: 0, txt_winery: 0, txt_title: 0, txt_category: 0, txt_top1: 0,
};

/**
 * Кандидаты запроса с признаками.
 * @param sims сходство с каждым референсом (порядок refs воркера)
 * @param slugsOfRef слаги каждого референса
 * @param text результат matchLabel по всему каталогу (candidates со скорами)
 */
export function buildCandidates(sims, slugsOfRef, text, { visTop = 20, txtTop = 5 } = {}) {
  const order = sims.map((s, i) => i).sort((a, b) => sims[b] - sims[a]);
  const rankOfRef = new Map(order.map((ref, r) => [ref, r + 1]));
  const refOfSlug = new Map();
  slugsOfRef.forEach((ss, i) => ss.forEach((s) => refOfSlug.set(s, i)));
  const vmax = sims[order[0]];

  const txtBySlug = new Map(text.candidates.map((c, i) => [c.slug, { ...c, rank: i + 1 }]));
  const tmax = text.candidates[0]?.score ?? 0;

  const pool = new Set();
  for (const ref of order.slice(0, visTop)) for (const s of slugsOfRef[ref]) pool.add(s);
  for (const c of text.candidates.slice(0, txtTop)) if (c.score > 0 && refOfSlug.has(c.slug)) pool.add(c.slug);

  return [...pool].map((slug) => {
    const ref = refOfSlug.get(slug);
    const t = txtBySlug.get(slug);
    const vis = sims[ref];
    return {
      slug,
      ref,
      x: {
        vis,
        vis_gap: vis - vmax,
        vis_logrank: Math.log(rankOfRef.get(ref)),
        txt: t?.score ?? 0,
        txt_gap: (t?.score ?? 0) - tmax,
        txt_winery: t?.winery_score ?? 0,
        txt_title: t?.title_score ?? 0,
        txt_category: t?.category_score ?? 0,
        txt_top1: t?.rank === 1 && tmax > 0 ? 1 : 0,
      },
    };
  });
}

/** Счёт и вероятность каждого кандидата, по убыванию. */
export function scoreCandidates(cands, weights) {
  const scores = cands.map((c) => FEATURES.reduce((acc, f) => acc + (weights[f] ?? 0) * c.x[f], 0));
  const m = Math.max(...scores);
  const exps = scores.map((s) => Math.exp(s - m));
  const z = exps.reduce((a, b) => a + b, 0);
  return cands
    .map((c, i) => ({ ...c, score: scores[i], p: exps[i] / z }))
    .sort((a, b) => b.p - a.p);
}

/**
 * Обучение условного логита (Adam): у признаков разный масштаб — vis ~0.5 при весе ~30,
 * log-ранг до 3, — и простой градиентный спуск за разумное число шагов не сходится.
 * @param queries [{cands, correct: Set<slug>}] — запросы, где правильный есть среди кандидатов
 */
// L2 почти нулевой: визуальному весу нужен масштаб ~40 (разница сходств в сотые доли),
// и заметный штраф тянет его вниз, размывая softmax — проверено, NLL растёт.
export function fitWeights(queries, { epochs = 1500, lr = 0.05, l2 = 1e-6, init = DEFAULT_WEIGHTS } = {}) {
  const w = { ...init };
  const m = Object.fromEntries(FEATURES.map((f) => [f, 0]));
  const v = Object.fromEntries(FEATURES.map((f) => [f, 0]));
  const usable = queries.filter((q) => q.cands.some((c) => q.correct.has(c.slug)));
  for (let ep = 0; ep < epochs; ep++) {
    const grad = Object.fromEntries(FEATURES.map((f) => [f, 0]));
    let nll = 0;
    for (const q of usable) {
      const scored = scoreCandidates(q.cands, w);
      // Несколько правильных (общее фото на два слага) — правдоподобие суммы их вероятностей.
      const pCorrect = scored.filter((c) => q.correct.has(c.slug)).reduce((a, c) => a + c.p, 0);
      nll -= Math.log(Math.max(pCorrect, 1e-12));
      for (const c of scored) {
        const target = q.correct.has(c.slug) ? c.p / pCorrect : 0;
        for (const f of FEATURES) grad[f] += (c.p - target) * c.x[f];
      }
    }
    for (const f of FEATURES) {
      const g = grad[f] / usable.length + l2 * w[f];
      m[f] = 0.9 * m[f] + 0.1 * g;
      v[f] = 0.999 * v[f] + 0.001 * g * g;
      const mh = m[f] / (1 - 0.9 ** (ep + 1));
      const vh = v[f] / (1 - 0.999 ** (ep + 1));
      w[f] -= lr * mh / (Math.sqrt(vh) + 1e-8);
    }
    if (ep % 300 === 0 || ep === epochs - 1) {
      console.log(`  fit эпоха ${ep}: nll ${(nll / usable.length).toFixed(4)} на ${usable.length} запросах`);
    }
  }
  return w;
}
