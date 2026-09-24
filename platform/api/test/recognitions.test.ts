import {
  API_ROUTES,
  ApiErrorBodySchema,
  HealthSchema,
  MAX_IMAGE_BYTES,
  RecognitionSchema,
  REQUEST_ID_HEADER,
  type ApiErrorBody,
} from '@winvino/contract';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.ts';
import { createMockRecognizer } from '../src/recognizer/mockRecognizer.ts';
import { RecognizerUnavailableError, type Recognizer } from '../src/recognizer/recognizer.ts';
import { scanRow, type ScanArchive, type ScanRecord } from '../src/scans/scanArchive.ts';
import { CORRUPT_JPEG, HEIC_HEADER, renderTestImage } from './testImages.ts';

const TEST_TIMEOUT_MS = 200;

function createTestApp(recognizer: Recognizer = createMockRecognizer({ delayMs: 0 }), corsOrigins: '*' | string[] = '*', archive?: ScanArchive) {
  return createApp({
    config: { corsOrigins, recognizeTimeoutMs: TEST_TIMEOUT_MS, isAccessLogEnabled: false },
    recognizer,
    archive,
  });
}

/** Архив пишет уже после ответа, поэтому тест ждёт не ответа, а самой записи. */
function createRecordingArchive(onSave: (record: ScanRecord) => Promise<void> = async () => {}) {
  const records: ScanRecord[] = [];
  let markSaved: () => void = () => {};
  const saved = new Promise<void>((resolve) => (markSaved = resolve));
  const archive: ScanArchive = {
    async save(record) {
      records.push(record);
      try {
        await onSave(record);
      } finally {
        markSaved();
      }
    },
  };
  return { records, saved, archive };
}

function postImage(app: ReturnType<typeof createApp>, bytes: Uint8Array, options: { field?: string; type?: string; headers?: Record<string, string> } = {}) {
  const form = new FormData();
  form.append(options.field ?? 'image', new Blob([bytes], { type: options.type ?? 'image/jpeg' }), 'label.jpg');
  return app.request(API_ROUTES.recognitions, { method: 'POST', body: form, headers: options.headers });
}

async function expectApiError(response: Response, httpStatus: number, code: string): Promise<ApiErrorBody['error']> {
  const body: unknown = await response.json();
  expect(response.status, JSON.stringify(body)).toBe(httpStatus);
  const parsed = ApiErrorBodySchema.parse(body);
  expect(parsed.error.code).toBe(code);
  expect(parsed.error.requestId).toBe(response.headers.get(REQUEST_ID_HEADER));
  return parsed.error;
}

describe(`POST ${API_ROUTES.recognitions}`, () => {
  it('returnsContractValidRecognitionForJpeg', async () => {
    const response = await postImage(createTestApp(), await renderTestImage('jpeg'));

    expect(response.status).toBe(200);
    expect(response.headers.get(REQUEST_ID_HEADER)).toBeTruthy();
    expect(RecognitionSchema.safeParse(await response.json()).success).toBe(true);
  });

  it.each(['png', 'webp'] as const)('accepts%sByFileSignatureEvenWithWrongContentType', async (format) => {
    const response = await postImage(createTestApp(), await renderTestImage(format), { type: 'application/octet-stream' });
    expect(response.status).toBe(200);
  });

  it('answersSamePhotoWithSameWine', async () => {
    const app = createTestApp();
    const photo = await renderTestImage('jpeg', { seed: 42 });
    const first = RecognitionSchema.parse(await (await postImage(app, photo)).json());
    const second = RecognitionSchema.parse(await (await postImage(app, photo)).json());

    expect(second.status).toBe(first.status);
    expect(second.match?.wine.id).toBe(first.match?.wine.id);
    expect(second.id).not.toBe(first.id);
  });

  it('rejectsFormWithoutImageField', async () => {
    const response = await postImage(createTestApp(), await renderTestImage('jpeg'), { field: 'photo' });
    await expectApiError(response, 400, 'IMAGE_REQUIRED');
  });

  it('rejectsNonMultipartBody', async () => {
    const response = await createTestApp().request(API_ROUTES.recognitions, {
      method: 'POST',
      body: JSON.stringify({ image: 'base64...' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const error = await expectApiError(response, 400, 'INVALID_REQUEST');
    expect(error.details).toEqual({ receivedContentType: 'application/json' });
  });

  it('rejectsTextDisguisedAsJpeg', async () => {
    const response = await postImage(createTestApp(), new TextEncoder().encode('definitely not a photo'));
    await expectApiError(response, 415, 'UNSUPPORTED_IMAGE_TYPE');
  });

  it('rejectsHeicWithConversionHint', async () => {
    const error = await expectApiError(await postImage(createTestApp(), HEIC_HEADER), 415, 'UNSUPPORTED_IMAGE_TYPE');
    expect(error.message).toContain('JPEG');
    expect(error.details).toEqual({ detected: 'image/heic' });
  });

  it('rejectsImageAboveSizeLimit', async () => {
    const oversized = new Uint8Array(MAX_IMAGE_BYTES + 1);
    oversized.set([0xff, 0xd8, 0xff]);
    await expectApiError(await postImage(createTestApp(), oversized), 413, 'IMAGE_TOO_LARGE');
  });

  it('rejectsThumbnailTooSmallToRead', async () => {
    const tiny = await renderTestImage('jpeg', { width: 120, height: 90 });
    const error = await expectApiError(await postImage(createTestApp(), tiny), 422, 'IMAGE_TOO_SMALL');
    expect(error.details).toMatchObject({ width: 120, height: 90 });
  });

  it('rejectsCorruptJpeg', async () => {
    await expectApiError(await postImage(createTestApp(), CORRUPT_JPEG), 422, 'IMAGE_UNREADABLE');
  });

  it('mapsUnavailableRecognizerTo503', async () => {
    const downRecognizer: Recognizer = {
      name: 'down',
      recognizeLabel: () => Promise.reject(new RecognizerUnavailableError('модель не поднята')),
    };
    await expectApiError(await postImage(createTestApp(downRecognizer), await renderTestImage('jpeg')), 503, 'RECOGNIZER_UNAVAILABLE');
  });

  it('abortsHangingRecognizerAfterTimeout', async () => {
    let receivedSignal: AbortSignal | undefined;
    const hangingRecognizer: Recognizer = {
      name: 'hanging',
      recognizeLabel: (_image, signal) => {
        receivedSignal = signal;
        return new Promise(() => {});
      },
    };
    await expectApiError(await postImage(createTestApp(hangingRecognizer), await renderTestImage('jpeg')), 503, 'RECOGNIZER_UNAVAILABLE');
    expect(receivedSignal?.aborted).toBe(true);
  });

  it('hidesRecognizerContractViolationBehind500', async () => {
    const brokenRecognizer = {
      name: 'broken',
      recognizeLabel: async () => ({ status: 'matched', reason: null, match: null, alternatives: [] }),
    } as unknown as Recognizer;
    await expectApiError(await postImage(createTestApp(brokenRecognizer), await renderTestImage('jpeg')), 500, 'INTERNAL_ERROR');
  });

  it('archivesScanUnderTheSameIdThatWentToClient', async () => {
    const { records, saved, archive } = createRecordingArchive();
    const photo = await renderTestImage('jpeg', { seed: 7 });

    const recognition = RecognitionSchema.parse(await (await postImage(createTestApp(undefined, '*', archive), photo)).json());
    await saved;

    expect(records).toHaveLength(1);
    const [scan] = records;
    if (!scan) throw new Error('архив ничего не получил');
    const row = scanRow(scan, 'test-matcher');
    expect(row.id).toBe(recognition.id);
    expect(row.source).toBe('production');
    expect(row.predictedWineSlug).toBe(recognition.match?.wine.slug ?? null);
    expect(row.candidates.status).toBe(recognition.status);
    expect(scan.imageBytes).toEqual(photo);
  });

  it('answersClientEvenWhenArchiveIsDown', async () => {
    const { saved, archive } = createRecordingArchive(async () => {
      throw new Error('база недоступна');
    });

    const response = await postImage(createTestApp(undefined, '*', archive), await renderTestImage('jpeg'));

    expect(response.status).toBe(200);
    expect(RecognitionSchema.safeParse(await response.json()).success).toBe(true);
    await expect(saved).resolves.toBeUndefined();
  });

  it('doesNotArchiveRejectedImages', async () => {
    const { records, archive } = createRecordingArchive();

    await expectApiError(await postImage(createTestApp(undefined, '*', archive), CORRUPT_JPEG), 422, 'IMAGE_UNREADABLE');

    expect(records).toEqual([]);
  });

  it('propagatesClientRequestIdIntoErrorBody', async () => {
    const response = await postImage(createTestApp(), CORRUPT_JPEG, { headers: { [REQUEST_ID_HEADER]: 'bot-update-123' } });
    const error = await expectApiError(response, 422, 'IMAGE_UNREADABLE');
    expect(error.requestId).toBe('bot-update-123');
  });
});

describe('service routes', () => {
  it('healthNamesActiveRecognizer', async () => {
    const response = await createTestApp().request(API_ROUTES.health);
    expect(HealthSchema.parse(await response.json())).toEqual({ status: 'ok', apiVersion: 'v1', recognizer: 'mock' });
  });

  it('servesOpenApiDocument', async () => {
    const document = (await (await createTestApp().request(API_ROUTES.openApi)).json()) as { openapi: string };
    expect(document.openapi).toBe('3.1.0');
  });

  it('answersUnknownRouteInErrorFormat', async () => {
    await expectApiError(await createTestApp().request('/v1/wines/unknown'), 404, 'NOT_FOUND');
  });

  it('allowsPreflightOnlyFromConfiguredOrigins', async () => {
    const app = createTestApp(undefined, ['https://app.winvino.test']);
    const preflight = (origin: string) =>
      app.request(API_ROUTES.recognitions, {
        method: 'OPTIONS',
        headers: { Origin: origin, 'Access-Control-Request-Method': 'POST' },
      });

    expect((await preflight('https://app.winvino.test')).headers.get('Access-Control-Allow-Origin')).toBe('https://app.winvino.test');
    expect((await preflight('https://evil.test')).headers.get('Access-Control-Allow-Origin')).toBeNull();
  });
});
