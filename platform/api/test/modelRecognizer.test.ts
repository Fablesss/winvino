import { API_ROUTES, ApiErrorBodySchema, RecognitionSchema, type Wine } from '@winvino/contract';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.ts';
import { createCatalogStore, type CatalogStore } from '../src/catalog/catalogStore.ts';
import { wineFromCatalogRow } from '../src/catalog/wineFromCatalogRow.ts';
import { MOCK_CATALOG_ROWS } from '../src/recognizer/mockCatalog.ts';
import {
  createModelRecognizer,
  decideOutcome,
  DEFAULT_MODEL_THRESHOLDS,
  type ModelResponse,
} from '../src/recognizer/modelRecognizer.ts';
import { renderTestImage } from './testImages.ts';

const WINES = MOCK_CATALOG_ROWS.map(wineFromCatalogRow);
const wineBySlug = new Map(WINES.map((wine) => [wine.slug, wine]));
const lookup = (slug: string) => wineBySlug.get(slug);
const slugAt = (i: number) => (WINES[i] as Wine).slug;

function modelResponse(overrides: Partial<ModelResponse> = {}): ModelResponse {
  return {
    candidates: [0.92, 0.04, 0.02, 0.01, 0.005].map((confidence, i) => ({ slug: slugAt(i), confidence, visual: 0.6 - i * 0.05, text: 0.3 })),
    visualMax: 0.62,
    ocrLetters: 40,
    ...overrides,
  };
}

const withMeta = (outcome: object) => ({ ...outcome, id: crypto.randomUUID(), processingMs: 1, createdAt: new Date().toISOString() });

describe('decideOutcome', () => {
  it('matchesConfidentLeaderWithAlternatives', () => {
    const outcome = decideOutcome(modelResponse(), lookup, DEFAULT_MODEL_THRESHOLDS);
    expect(outcome.status).toBe('matched');
    expect(outcome.match?.wine.slug).toBe(slugAt(0));
    expect(outcome.alternatives.map((a) => a.wine.slug)).toEqual([slugAt(1), slugAt(2), slugAt(3)]);
    expect(RecognitionSchema.safeParse(withMeta(outcome)).success).toBe(true);
  });

  it('flagsUncertainLeaderAsAmbiguous', () => {
    const candidates = modelResponse().candidates.map((c, i) => ({ ...c, confidence: i === 0 ? 0.55 : c.confidence }));
    const outcome = decideOutcome(modelResponse({ candidates }), lookup, DEFAULT_MODEL_THRESHOLDS);
    expect(outcome.status).toBe('ambiguous');
    expect(outcome.match?.confidence).toBe(0.55);
  });

  it('saysNotInCatalogWhenNothingLooksAlikeButTextIsReadable', () => {
    const outcome = decideOutcome(modelResponse({ visualMax: 0.31, ocrLetters: 30 }), lookup, DEFAULT_MODEL_THRESHOLDS);
    expect(outcome).toEqual({ status: 'not_found', reason: 'not_in_catalog', match: null, alternatives: [] });
    expect(RecognitionSchema.safeParse(withMeta(outcome)).success).toBe(true);
  });

  it('asksToReshootWhenNothingLooksAlikeAndNothingIsReadable', () => {
    const outcome = decideOutcome(modelResponse({ visualMax: 0.2, ocrLetters: 2 }), lookup, DEFAULT_MODEL_THRESHOLDS);
    expect(outcome).toMatchObject({ status: 'not_found', reason: 'unreadable' });
  });

  it('skipsSlugsMissingFromPublishedCatalog', () => {
    const candidates = [{ slug: 'snyato-s-sayta', confidence: 0.9, visual: 0.7, text: 0.5 }, ...modelResponse().candidates];
    const outcome = decideOutcome(modelResponse({ candidates }), lookup, DEFAULT_MODEL_THRESHOLDS);
    expect(outcome.match?.wine.slug).toBe(slugAt(0));
  });

  it('treatsOnlyUnknownSlugsAsNotInCatalog', () => {
    const candidates = [{ slug: 'snyato-s-sayta', confidence: 0.9, visual: 0.7, text: 0.5 }];
    expect(decideOutcome(modelResponse({ candidates }), lookup, DEFAULT_MODEL_THRESHOLDS)).toMatchObject({ status: 'not_found', reason: 'not_in_catalog' });
  });

  it('respectsConfiguredAlternativesLimit', () => {
    const outcome = decideOutcome(modelResponse(), lookup, { ...DEFAULT_MODEL_THRESHOLDS, maxAlternatives: 1 });
    expect(outcome.alternatives).toHaveLength(1);
  });
});

const TEST_TIMEOUT_MS = 200;
const loadedCatalog: Pick<CatalogStore, 'get' | 'isLoaded'> = { get: lookup, isLoaded: () => true };

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

async function postPhoto(fetchImpl: typeof fetch, catalog = loadedCatalog) {
  const recognizer = createModelRecognizer({ url: 'http://recognizer.test:8080/', catalog, fetchImpl });
  const app = createApp({ config: { corsOrigins: '*', recognizeTimeoutMs: TEST_TIMEOUT_MS, isAccessLogEnabled: false }, recognizer });
  const form = new FormData();
  form.append('image', new Blob([await renderTestImage('jpeg')], { type: 'image/jpeg' }), 'label.jpg');
  return app.request(API_ROUTES.recognitions, { method: 'POST', body: form });
}

async function expectErrorCode(response: Response, httpStatus: number, code: string) {
  const body: unknown = await response.json();
  expect(response.status, JSON.stringify(body)).toBe(httpStatus);
  expect(ApiErrorBodySchema.parse(body).error.code).toBe(code);
}

describe('model recognizer through POST /v1/recognitions', () => {
  it('returnsContractValidRecognitionFromModelService', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse(modelResponse()));
    const response = await postPhoto(fetchImpl);

    expect(response.status).toBe(200);
    const recognition = RecognitionSchema.parse(await response.json());
    expect(recognition).toMatchObject({ status: 'matched', match: { wine: { slug: slugAt(0) }, confidence: 0.92 } });

    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe('http://recognizer.test:8080/v1/recognize');
    const sent = (init?.body as FormData).get('image');
    expect(sent).toBeInstanceOf(Blob);
    expect((sent as Blob).type).toBe('image/jpeg');
  });

  it('mapsStartingModelServiceTo503', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ error: 'unavailable', message: 'распознаватель поднимается' }, 503));
    await expectErrorCode(await postPhoto(fetchImpl), 503, 'RECOGNIZER_UNAVAILABLE');
  });

  it('mapsRefusedConnectionTo503', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => { throw new TypeError('fetch failed'); });
    await expectErrorCode(await postPhoto(fetchImpl), 503, 'RECOGNIZER_UNAVAILABLE');
  });

  it('abortsHangingModelServiceAfterTimeout', async () => {
    let receivedSignal: AbortSignal | undefined;
    const fetchImpl = vi.fn<typeof fetch>((_url, init) => {
      receivedSignal = init?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
      });
    });
    await expectErrorCode(await postPhoto(fetchImpl), 503, 'RECOGNIZER_UNAVAILABLE');
    expect(receivedSignal?.aborted).toBe(true);
  });

  it('answers503UntilCatalogIsLoaded', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse(modelResponse()));
    await expectErrorCode(await postPhoto(fetchImpl, { get: lookup, isLoaded: () => false }), 503, 'RECOGNIZER_UNAVAILABLE');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('hidesMalformedModelResponseBehind500', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ candidates: 'none' }));
    await expectErrorCode(await postPhoto(fetchImpl), 500, 'INTERNAL_ERROR');
  });
});

describe('createCatalogStore', () => {
  const quietLog = { log: () => {}, error: () => {} };

  it('servesWinesFromMemoryAfterLoad', async () => {
    const store = createCatalogStore({ load: async () => MOCK_CATALOG_ROWS, refreshMs: 60_000, log: quietLog });
    await store.firstAttempt;
    expect(store.isLoaded()).toBe(true);
    expect(store.size()).toBe(MOCK_CATALOG_ROWS.length);
    expect(store.get(slugAt(0))?.title).toBe((WINES[0] as Wine).title);
    store.stop();
  });

  it('retriesUntilDatabaseAnswers', async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error('connect timeout')).mockResolvedValue(MOCK_CATALOG_ROWS);
    const store = createCatalogStore({ load, refreshMs: 60_000, retryMs: 5, log: quietLog });
    await store.firstAttempt;
    expect(store.isLoaded()).toBe(false);
    await vi.waitFor(() => expect(store.isLoaded()).toBe(true));
    store.stop();
  });

  it('keepsPreviousCopyWhenRefreshFails', async () => {
    const load = vi.fn().mockResolvedValueOnce(MOCK_CATALOG_ROWS).mockRejectedValue(new Error('connection reset'));
    const store = createCatalogStore({ load, refreshMs: 5, log: quietLog });
    await store.firstAttempt;
    await vi.waitFor(() => expect(load.mock.calls.length).toBeGreaterThanOrEqual(2));
    expect(store.isLoaded()).toBe(true);
    expect(store.get(slugAt(0))).toBeDefined();
    store.stop();
  });
});
