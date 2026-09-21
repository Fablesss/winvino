// Распознавание вина по фото: визуальный воркер (локатор + SigLIP2) и OCR-воркер
// (PaddleOCR) → OCR-матчер по каталогу → слияние сигналов → слаг и уверенность.
//
// Один и тот же путь для сервиса (scripts/serve-eval.mjs) и офлайн-оценки
// (scripts/eval-recognizer.mjs): метрики меряют ровно то, что отвечает сервис.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { indexFromManifest, readManifest } from './catalog-manifest.mjs';
import { buildCandidates, DEFAULT_WEIGHTS, scoreCandidates } from './fusion.mjs';
import { matchLabel } from './matcher.mjs';
import { startWorker } from './workers.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const MANIFEST_PATH = path.join(ROOT, 'data', 'raw', 'dataset', 'catalog.jsonl');
/** Конфиг, который пишет eval-recognizer --fit: чекпойнт энкодера и веса слияния. */
export const CONFIG_PATH = path.join(ROOT, 'data', 'raw', 'model', 'recognizer.json');

const ML_PYTHON = process.env.ML_PYTHON ?? path.join(ROOT, '.venv-ml', 'Scripts', 'python.exe');
const OCR_PYTHON = process.env.OCR_PYTHON ?? path.join(ROOT, '.venv-ocr', 'Scripts', 'python.exe');

export function loadConfig(configPath = CONFIG_PATH) {
  // minVisual — отказ «вина нет в каталоге» по абсолютному сходству лучшего референса:
  // softmax-уверенность относительна и на чужом вине бывает высокой, а сходство — нет.
  const base = { checkpoint: null, weights: DEFAULT_WEIGHTS, visTop: 20, txtTop: 5, minConfidence: 0, minVisual: 0 };
  if (!fs.existsSync(configPath)) return base;
  return { ...base, ...JSON.parse(fs.readFileSync(configPath, 'utf8')) };
}

/**
 * Поднимает воркеры и индекс матчера. `ocr: false` — только визуал (для замеров).
 * `config` переопределяет поля recognizer.json (checkpoint, weights, minConfidence).
 */
export async function createRecognizer({ config = {}, ocr = true, log = console.log } = {}) {
  const cfg = { ...loadConfig(), ...config };
  const entries = readManifest(MANIFEST_PATH);
  const textIndex = indexFromManifest(entries);

  const visualArgs = ['-m', 'ml.worker'];
  if (cfg.checkpoint) visualArgs.push('--checkpoint', path.resolve(ROOT, cfg.checkpoint));
  const visual = startWorker('visual', ML_PYTHON, visualArgs, { cwd: ROOT });
  const ocrWorker = ocr ? startWorker('ocr', OCR_PYTHON, ['ocr/paddle_worker.py'], { cwd: ROOT }) : null;
  const [vInfo] = await Promise.all([visual.ready, ocrWorker?.ready]);
  const { slugs: slugsOfRef } = await visual.call({ cmd: 'refs' });
  log(`распознаватель готов: ${vInfo.model}, референсов ${vInfo.refs}, слагов ${entries.length}, OCR ${ocr ? 'да' : 'нет'}`);

  /**
   * @param imagePath путь к файлу на диске
   * @param ocrCache Map «ключ → ответ OCR» — для офлайн-оценки, чтобы не гонять OCR повторно
   */
  async function recognize(imagePath, { ocrCache = null } = {}) {
    const t0 = performance.now();
    const v = await visual.call({ path: imagePath });
    if (v.error) throw new Error(`visual: ${v.error}`);
    const tVisual = performance.now();

    let ocrRes = { text: '', ms: 0 };
    if (ocrWorker) {
      const key = `${imagePath}|${v.box.join(',')}`;
      if (ocrCache?.has(key)) ocrRes = ocrCache.get(key);
      else {
        ocrRes = await ocrWorker.call({ path: imagePath, box: v.box });
        if (ocrCache && !ocrRes.error) ocrCache.set(key, ocrRes);
      }
    }
    const tOcr = performance.now();

    const text = matchLabel(textIndex, ocrRes.text ?? '', { limit: textIndex.wines.length });
    const cands = buildCandidates(v.sims, slugsOfRef, text, { visTop: cfg.visTop, txtTop: cfg.txtTop });
    const ranked = scoreCandidates(cands, cfg.weights);
    const best = ranked[0];
    const visMax = Math.max(...v.sims);
    let rejected = null;
    if (!best) rejected = 'no_candidates';
    else if (visMax < cfg.minVisual) rejected = 'not_in_catalog';
    else if (best.p < cfg.minConfidence) rejected = 'low_confidence';
    return {
      slug: rejected ? null : best.slug,
      confidence: best ? Number(best.p.toFixed(4)) : 0,
      visual_max: visMax,
      rejected,
      candidates: ranked.slice(0, 5).map((c) => ({ slug: c.slug, p: Number(c.p.toFixed(4)), vis: c.x.vis, txt: c.x.txt })),
      ocr_text: ocrRes.text ?? '',
      box: v.box,
      box_source: v.box_source,
      ms: { visual: Math.round(tVisual - t0), ocr: Math.round(tOcr - tVisual), total: Math.round(performance.now() - t0) },
      _ranked: ranked, // полные кандидаты с признаками — для обучения слияния
    };
  }

  function stop() {
    visual.stop();
    ocrWorker?.stop();
  }

  return { recognize, stop, config: cfg };
}
