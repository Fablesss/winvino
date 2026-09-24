import { RECOGNITION_IMAGE_FIELD, type Wine, type WineCandidate } from '@winvino/contract';
import { z } from 'zod';
import type { CatalogStore } from '../catalog/catalogStore.ts';
import { IMAGE_EXTENSION } from '../image/inspectImage.ts';
import { RecognizerUnavailableError, type RecognitionOutcome, type Recognizer } from './recognizer.ts';

export const MODEL_RECOGNIZER_NAME = 'model';

/**
 * Ответ POST /v1/recognize сервиса распознавания (scripts/serve-recognizer.mjs в корне
 * репозитория) — внутренний контракт. Сервис отдаёт сигналы, решение принимается здесь.
 */
export const ModelResponseSchema = z.object({
  candidates: z.array(
    z.object({
      slug: z.string().min(1),
      confidence: z.number().min(0).max(1),
      visual: z.number(),
      text: z.number(),
    }),
  ),
  /** Сходство лучшего референса каталога — абсолютное, в отличие от confidence. */
  visualMax: z.number(),
  /** Сколько букв прочитал OCR на кадре. */
  ocrLetters: z.number().int().nonnegative(),
});
export type ModelResponse = z.infer<typeof ModelResponseSchema>;

/**
 * Пороги решения. Значения по умолчанию выведены из eval-набора (docs/RECOGNIZER.md):
 * - matched с 0.8: на отложенной синтетике matched получают 77% кадров, из них верно 97.0%
 *   (выше 0.8 точность не растёт, только падает покрытие); на реальных фото — 73%, верно 100%;
 *   в ambiguous правильное вино среди лидера и 3 альтернатив в 98.6% случаев;
 * - not_found при сходстве ниже 0.4: на 700 синтетических и 11 реальных кадрах из каталога —
 *   ни одного ложного отказа; обе контрольные бутылки организатора вне каталога — 0.31 и 0.30.
 */
export type ModelThresholds = {
  matchedMinConfidence: number;
  notInCatalogMaxVisual: number;
  /** Букв OCR не больше этого — «текста не видно»: unreadable (переснять), а не not_in_catalog. */
  unreadableMaxOcrLetters: number;
  maxAlternatives: number;
};

export const DEFAULT_MODEL_THRESHOLDS: ModelThresholds = {
  matchedMinConfidence: 0.8,
  notInCatalogMaxVisual: 0.4,
  unreadableMaxOcrLetters: 3,
  maxAlternatives: 3,
};

const roundConfidence = (confidence: number) => Math.min(1, Math.max(0, Math.round(confidence * 1000) / 1000));

/**
 * Решение по ответу модели. Слаги, которых нет в каталоге сайта (в выгрузке для обучения их
 * больше, чем опубликовано), отбрасываются: показывать пользователю нечего.
 */
export function decideOutcome(
  response: ModelResponse,
  lookup: (slug: string) => Wine | undefined,
  thresholds: ModelThresholds,
): RecognitionOutcome {
  const known: WineCandidate[] = response.candidates.flatMap((candidate) => {
    const wine = lookup(candidate.slug);
    return wine ? [{ wine, confidence: roundConfidence(candidate.confidence) }] : [];
  });
  const [match, ...rest] = known;
  if (!match) return { status: 'not_found', reason: 'not_in_catalog', match: null, alternatives: [] };
  if (response.visualMax < thresholds.notInCatalogMaxVisual) {
    const reason = response.ocrLetters <= thresholds.unreadableMaxOcrLetters ? 'unreadable' : 'not_in_catalog';
    return { status: 'not_found', reason, match: null, alternatives: [] };
  }
  return {
    status: match.confidence >= thresholds.matchedMinConfidence ? 'matched' : 'ambiguous',
    reason: null,
    match,
    alternatives: rest.slice(0, thresholds.maxAlternatives),
  };
}

export function createModelRecognizer(options: {
  url: string;
  catalog: Pick<CatalogStore, 'get' | 'isLoaded'>;
  thresholds?: ModelThresholds;
  fetchImpl?: typeof fetch;
}): Recognizer {
  const { catalog, thresholds = DEFAULT_MODEL_THRESHOLDS, fetchImpl = fetch } = options;
  const endpoint = `${options.url.replace(/\/+$/, '')}/v1/recognize`;

  return {
    name: MODEL_RECOGNIZER_NAME,
    async recognizeLabel(image, signal) {
      if (!catalog.isLoaded()) throw new RecognizerUnavailableError('каталог вин ещё не загружен из базы');

      const form = new FormData();
      form.append(RECOGNITION_IMAGE_FIELD, new Blob([image.bytes], { type: image.mimeType }), `label.${IMAGE_EXTENSION[image.mimeType]}`);
      let response: Response;
      try {
        response = await fetchImpl(endpoint, { method: 'POST', body: form, signal });
      } catch (error) {
        throw new RecognizerUnavailableError(`сервис распознавания недоступен: ${(error as Error).message}`, { cause: error });
      }
      // 503 — модели поднимаются, воркер перезапускается или очередь полна: временно.
      if (response.status === 503) {
        throw new RecognizerUnavailableError(`сервис распознавания не готов: ${await response.text()}`);
      }
      if (!response.ok) throw new Error(`сервис распознавания ответил ${response.status}: ${await response.text()}`);

      const parsed = ModelResponseSchema.safeParse(await response.json());
      if (!parsed.success) throw new Error(`ответ сервиса распознавания не по контракту: ${parsed.error.message}`);
      return decideOutcome(parsed.data, (slug) => catalog.get(slug), thresholds);
    },
  };
}
