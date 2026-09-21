// Распознавание вина по фото: визуальный воркер (локатор + SigLIP2) и OCR-воркер
// (PaddleOCR) → OCR-матчер по каталогу → слияние сигналов → слаг и уверенность.
//
// Один и тот же путь для сервиса (scripts/serve-recognizer.mjs) и офлайн-оценки
// (scripts/eval-recognizer.mjs): метрики меряют ровно то, что отвечает сервис.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { indexFromManifest, readManifest } from './catalog-manifest.mjs';
import { buildCandidates, DEFAULT_WEIGHTS, scoreCandidates } from './fusion.mjs';
import { matchLabel } from './matcher.mjs';
import { startWorker, WorkerUnavailableError } from './workers.mjs';

export { WorkerUnavailableError };

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
/** Корень артефактов — тот же, что у Python (ml/common.py: WINVINO_DATA_DIR). */
export const DATA_DIR = path.resolve(process.env.WINVINO_DATA_DIR || path.join(ROOT, 'data', 'raw'));
export const MANIFEST_PATH = path.join(DATA_DIR, 'dataset', 'catalog.jsonl');
/** Конфиг, который пишет eval-recognizer --write-config: чекпойнт энкодера (от DATA_DIR) и веса слияния. */
export const CONFIG_PATH = path.join(DATA_DIR, 'model', 'recognizer.json');

const WIN = process.platform === 'win32';
const venvPython = (venv) => path.join(ROOT, venv, WIN ? 'Scripts' : 'bin', WIN ? 'python.exe' : 'python');
const ML_PYTHON = process.env.ML_PYTHON ?? venvPython('.venv-ml');
const OCR_PYTHON = process.env.OCR_PYTHON ?? venvPython('.venv-ocr');
const WORKER_TIMEOUT_MS = Number(process.env.RECOGNIZER_WORKER_TIMEOUT_MS ?? 60_000);

export function loadConfig(configPath = CONFIG_PATH) {
  // minVisual — отказ «вина нет в каталоге» по абсолютному сходству лучшего референса:
  // softmax-уверенность относительна и на чужом вине бывает высокой, а сходство — нет.
  const base = { checkpoint: null, weights: DEFAULT_WEIGHTS, visTop: 20, txtTop: 5, minConfidence: 0, minVisual: 0 };
  if (!fs.existsSync(configPath)) return base;
  return { ...base, ...JSON.parse(fs.readFileSync(configPath, 'utf8')) };
}

/** Сколько букв прочитал OCR: 0–2 значит «текста на кадре не видно». */
const countLetters = (text) => (text.match(/\p{L}/gu) ?? []).length;

/**
 * Поднимает воркеры и индекс матчера, не дожидаясь готовности моделей: HTTP-сервер может
 * слушать сразу и отвечать «поднимаюсь», пока грузятся веса. `ready` — первый подъём.
 * `config` переопределяет поля recognizer.json (checkpoint, weights, minConfidence, minVisual).
 */
export function createRecognizer({ config = {}, ocr = true, log = console.log } = {}) {
  const cfg = { ...loadConfig(), ...config };
  const entries = readManifest(MANIFEST_PATH);
  const textIndex = indexFromManifest(entries);
  const workerOpts = { cwd: ROOT, env: { WINVINO_DATA_DIR: DATA_DIR }, callTimeoutMs: WORKER_TIMEOUT_MS, log: console.error };

  const visualArgs = ['-m', 'ml.worker'];
  if (cfg.checkpoint) visualArgs.push('--checkpoint', path.resolve(DATA_DIR, cfg.checkpoint));
  const visual = startWorker('visual', ML_PYTHON, visualArgs, workerOpts);
  const ocrWorker = ocr ? startWorker('ocr', OCR_PYTHON, ['ocr/paddle_worker.py'], workerOpts) : null;

  // Порядок референсов задаёт индекс воркера; перечитываем на каждый подъём.
  let slugsOfRef = null;
  let model = null;
  visual.onReady(async (info) => {
    model = info.model;
    try {
      slugsOfRef = (await visual.call({ cmd: 'refs' })).slugs;
    } catch (err) {
      console.error(`visual: не удалось получить список референсов: ${err.message}`);
    }
  });
  const isReady = () => visual.isReady() && slugsOfRef !== null && (!ocrWorker || ocrWorker.isReady());
  const ready = Promise.all([visual.ready, ocrWorker?.ready]).then(async () => {
    while (!isReady()) await new Promise((r) => setTimeout(r, 50));
    log(`распознаватель готов: ${model}, референсов ${slugsOfRef.length}, слагов ${entries.length}, OCR ${ocr ? 'да' : 'нет'}`);
  });

  /**
   * @param imagePath путь к файлу на диске
   * @param ocrCache Map «ключ → ответ OCR» — для офлайн-оценки, чтобы не гонять OCR повторно
   */
  async function recognize(imagePath, { ocrCache = null } = {}) {
    if (!isReady()) throw new WorkerUnavailableError('распознаватель поднимается');
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

    const ocrText = ocrRes.text ?? '';
    const text = matchLabel(textIndex, ocrText, { limit: textIndex.wines.length });
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
      ocr_text: ocrText,
      ocr_letters: countLetters(ocrText),
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

  return { recognize, ready, isReady, stop, config: cfg, model: () => model };
}
