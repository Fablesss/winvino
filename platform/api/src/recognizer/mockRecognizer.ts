import { createHash } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import type { Wine, WineCandidate } from '@winvino/contract';
import { wineFromCatalogRow } from '../catalog/wineFromCatalogRow.ts';
import { MOCK_CATALOG_ROWS } from './mockCatalog.ts';
import type { Recognizer } from './recognizer.ts';

export const MOCK_RECOGNIZER_NAME = 'mock';

type MockScenario = 'matched' | 'ambiguous' | 'not_in_catalog' | 'unreadable';

/** Из 20 фото: 12 matched, 5 ambiguous, 2 not_in_catalog, 1 unreadable — чтобы клиенты видели все ветки. */
const SCENARIO_BUCKETS = 20;
const MATCHED_BUCKETS = 12;
const AMBIGUOUS_BUCKETS = 5;
const NOT_IN_CATALOG_BUCKETS = 2;

const ALTERNATIVES_COUNT = 3;
const MATCHED_CONFIDENCE = { min: 0.85, spread: 0.13 };
const AMBIGUOUS_CONFIDENCE = { min: 0.4, spread: 0.2 };
/** Насколько каждая следующая альтернатива слабее предыдущей. */
const MATCHED_ALTERNATIVE_STEP = 0.25;
const AMBIGUOUS_ALTERNATIVE_STEP = 0.08;

function pickScenario(scenarioByte: number): MockScenario {
  const bucket = scenarioByte % SCENARIO_BUCKETS;
  if (bucket < MATCHED_BUCKETS) return 'matched';
  if (bucket < MATCHED_BUCKETS + AMBIGUOUS_BUCKETS) return 'ambiguous';
  if (bucket < MATCHED_BUCKETS + AMBIGUOUS_BUCKETS + NOT_IN_CATALOG_BUCKETS) return 'not_in_catalog';
  return 'unreadable';
}

const roundConfidence = (confidence: number) => Math.max(0, Math.round(confidence * 100) / 100);

/**
 * Заглушка до готовности модели. Ответ детерминирован по sha256 фото: одно и то же фото —
 * один и тот же ответ, разные фото — разные вина и сценарии. Вина — реальные из каталога.
 */
export function createMockRecognizer(options: { delayMs: number; wines?: Wine[] }): Recognizer {
  const wines = options.wines ?? MOCK_CATALOG_ROWS.map(wineFromCatalogRow);

  return {
    name: MOCK_RECOGNIZER_NAME,
    async recognizeLabel(image, signal) {
      // Без задержки таймер не заводим: на Windows даже setTimeout(0) спит ~15 мс.
      if (options.delayMs > 0) await sleep(options.delayMs, undefined, { signal });
      signal.throwIfAborted();

      const [scenarioByte = 0, wineByte = 0, confidenceByte = 0] = createHash('sha256').update(image.bytes).digest();
      const scenario = pickScenario(scenarioByte);
      if (scenario === 'not_in_catalog' || scenario === 'unreadable') {
        return { status: 'not_found', reason: scenario, match: null, alternatives: [] };
      }

      const confidenceRange = scenario === 'matched' ? MATCHED_CONFIDENCE : AMBIGUOUS_CONFIDENCE;
      const step = scenario === 'matched' ? MATCHED_ALTERNATIVE_STEP : AMBIGUOUS_ALTERNATIVE_STEP;
      const topConfidence = confidenceRange.min + (confidenceByte / 255) * confidenceRange.spread;

      const candidates: WineCandidate[] = Array.from({ length: ALTERNATIVES_COUNT + 1 }, (_, rank) => ({
        wine: wines[(wineByte + rank) % wines.length] as Wine,
        confidence: roundConfidence(topConfidence - rank * step),
      }));
      const [match, ...alternatives] = candidates as [WineCandidate, ...WineCandidate[]];
      return { status: scenario, reason: null, match, alternatives };
    },
  };
}
