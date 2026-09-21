import { randomBytes } from 'node:crypto';
import { RecognitionSchema } from '@winvino/contract';
import { describe, expect, it } from 'vitest';
import { createMockRecognizer } from '../src/recognizer/mockRecognizer.ts';

const SAMPLE_PHOTOS = 400;

describe('createMockRecognizer', () => {
  it('producesContractValidOutcomesAcrossAllScenarios', async () => {
    const recognizer = createMockRecognizer({ delayMs: 0 });
    const seenScenarios = new Set<string>();

    for (let photo = 0; photo < SAMPLE_PHOTOS; photo += 1) {
      const outcome = await recognizer.recognizeLabel(
        { bytes: randomBytes(256), mimeType: 'image/jpeg', width: 800, height: 600 },
        new AbortController().signal,
      );
      const recognition = RecognitionSchema.safeParse({
        ...outcome,
        id: '0f7a3c52-8a0e-4b8e-9d2a-3c1f7f0b9a11',
        processingMs: 0,
        createdAt: new Date().toISOString(),
      });
      expect(recognition.error?.issues ?? []).toEqual([]);
      seenScenarios.add(outcome.status === 'not_found' ? `not_found:${outcome.reason}` : outcome.status);
    }

    expect([...seenScenarios].sort()).toEqual(['ambiguous', 'matched', 'not_found:not_in_catalog', 'not_found:unreadable']);
  });

  it('stopsWaitingWhenAborted', async () => {
    const controller = new AbortController();
    const pending = createMockRecognizer({ delayMs: 60_000 }).recognizeLabel(
      { bytes: randomBytes(16), mimeType: 'image/jpeg', width: 800, height: 600 },
      controller.signal,
    );
    controller.abort();
    await expect(pending).rejects.toThrow(/abort/i);
  });
});
