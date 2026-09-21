import { describe, expect, it } from 'vitest';
import { RecognitionSchema } from '../src/index.ts';
import { sampleMatched, sampleWine } from './sampleRecognition.ts';

describe('RecognitionSchema', () => {
  it('acceptsMatched', () => {
    expect(RecognitionSchema.safeParse(sampleMatched).success).toBe(true);
  });

  it('acceptsNotFoundWithReason', () => {
    const notFound = { ...sampleMatched, status: 'not_found', reason: 'unreadable', match: null, alternatives: [] };
    expect(RecognitionSchema.safeParse(notFound).success).toBe(true);
  });

  it('rejectsMatchedWithoutMatch', () => {
    expect(RecognitionSchema.safeParse({ ...sampleMatched, match: null }).success).toBe(false);
  });

  it('rejectsNotFoundCarryingCandidates', () => {
    const notFound = {
      ...sampleMatched,
      status: 'not_found',
      reason: 'not_in_catalog',
      match: null,
      alternatives: [{ wine: sampleWine, confidence: 0.1 }],
    };
    expect(RecognitionSchema.safeParse(notFound).success).toBe(false);
  });

  it('rejectsConfidenceAboveOne', () => {
    expect(RecognitionSchema.safeParse({ ...sampleMatched, match: { wine: sampleWine, confidence: 1.2 } }).success).toBe(false);
  });

  it('ignoresUnknownFieldsSoServerCanAddThem', () => {
    const parsed = RecognitionSchema.parse({ ...sampleMatched, addedInV1_1: true });
    expect(parsed).not.toHaveProperty('addedInV1_1');
  });
});
