import {
  ADMIN_ROUTES,
  AdminScanPageSchema,
  AdminScanSchema,
  AdminWineSearchSchema,
  ApiErrorBodySchema,
  type AdminScan,
  type AdminScanPage,
  type ApiErrorBody,
} from '@winvino/contract';
import { describe, expect, it, vi } from 'vitest';
import type { AdminImage } from '../src/admin/adminImage.ts';
import type { AdminStore, AdminTruthResult } from '../src/admin/adminStore.ts';
import { createApp } from '../src/app.ts';
import { createMockRecognizer } from '../src/recognizer/mockRecognizer.ts';

const PASSWORD = 'razmetka-parol-12';
const SCAN_ID = 'f2b9a4c1-0d3e-4a7b-9c11-8e5d6f2a3b40';

const SCAN: AdminScan = {
  id: SCAN_ID,
  createdAt: '2026-09-29T10:00:00.000Z',
  imageSha256: 'a'.repeat(64),
  matcherVersion: 'siglip2-b16-ft1-e4',
  status: 'ambiguous',
  reason: null,
  processingMs: 640,
  predicted: { slug: 'belbek-risling', title: 'Бельбек Рислинг', manufacturerName: 'Бельбек', confidence: 0.61 },
  candidates: [
    { slug: 'belbek-risling', title: 'Бельбек Рислинг', manufacturerName: 'Бельбек', confidence: 0.61 },
    { slug: 'zaharin-rubedo', title: 'Rubedo. Reserve', manufacturerName: 'Валерий Захарьин', confidence: 0.44 },
  ],
  truth: { kind: 'none', wine: null },
  truthRank: null,
};

const PAGE: AdminScanPage = { items: [SCAN], nextCursor: null, pendingTotal: 1 };

const PNG: AdminImage = { bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]), contentType: 'image/png' };

function createTestApp(overrides: Partial<AdminStore> = {}, image: AdminImage | null = PNG) {
  const store: AdminStore = {
    listScans: vi.fn(async () => PAGE),
    getScan: vi.fn(async () => SCAN),
    setTruth: vi.fn(async (): Promise<AdminTruthResult> => ({ status: 'saved', scan: SCAN })),
    scanImagePath: vi.fn(async () => 'production/ab/abc.png'),
    searchWines: vi.fn(async () => [{ slug: 'belbek-risling', title: 'Бельбек Рислинг', manufacturerName: 'Бельбек' }]),
    close: vi.fn(async () => {}),
    ...overrides,
  };
  const app = createApp({
    config: { corsOrigins: '*', recognizeTimeoutMs: 200, isAccessLogEnabled: false },
    recognizer: createMockRecognizer({ delayMs: 0 }),
    admin: { password: PASSWORD, store, readImage: async () => image },
  });
  return { app, store };
}

const asAdmin = { Authorization: `Bearer ${PASSWORD}` };

async function expectErrorCode(response: Response, httpStatus: number, code: string): Promise<ApiErrorBody['error']> {
  const body: unknown = await response.json();
  expect(response.status, JSON.stringify(body)).toBe(httpStatus);
  const parsed = ApiErrorBodySchema.parse(body);
  expect(parsed.error.code).toBe(code);
  return parsed.error;
}

describe('очередь разметки /v1/admin', () => {
  it('безПароляВОкруженииРоутовНет', async () => {
    const app = createApp({
      config: { corsOrigins: '*', recognizeTimeoutMs: 200, isAccessLogEnabled: false },
      recognizer: createMockRecognizer({ delayMs: 0 }),
    });
    await expectErrorCode(await app.request(ADMIN_ROUTES.scans), 404, 'NOT_FOUND');
  });

  it('анонимНеВидитНиСписокНиФото', async () => {
    const { app, store } = createTestApp();
    const closed = [ADMIN_ROUTES.scans, ADMIN_ROUTES.scan(SCAN_ID), ADMIN_ROUTES.scanImage(SCAN_ID), `${ADMIN_ROUTES.wines}?q=бельбек`];
    for (const path of closed) {
      await expectErrorCode(await app.request(path), 401, 'UNAUTHORIZED');
    }
    await expectErrorCode(
      await app.request(ADMIN_ROUTES.scanTruth(SCAN_ID), { method: 'POST', body: JSON.stringify({ kind: 'absent' }) }),
      401,
      'UNAUTHORIZED',
    );
    // Главное: до базы и диска запрос вообще не дошёл.
    expect(store.listScans).not.toHaveBeenCalled();
    expect(store.getScan).not.toHaveBeenCalled();
    expect(store.scanImagePath).not.toHaveBeenCalled();
    expect(store.setTruth).not.toHaveBeenCalled();
  });

  it('чужойПарольОтклоняется', async () => {
    const { app } = createTestApp();
    const response = await app.request(ADMIN_ROUTES.scans, { headers: { Authorization: `Bearer ${PASSWORD}x` } });
    await expectErrorCode(response, 401, 'UNAUTHORIZED');
  });

  it('очередьОтдаётСтраницуПоСхемеКонтракта', async () => {
    const { app, store } = createTestApp();
    const response = await app.request(`${ADMIN_ROUTES.scans}?filter=labeled&limit=5`, { headers: asAdmin });
    expect(response.status).toBe(200);
    expect(AdminScanPageSchema.parse(await response.json())).toEqual(PAGE);
    expect(store.listScans).toHaveBeenCalledWith({ filter: 'labeled', limit: 5 });
  });

  it('одинСканДляЭкранаРазметки', async () => {
    const { app } = createTestApp();
    const response = await app.request(ADMIN_ROUTES.scan(SCAN_ID), { headers: asAdmin });
    expect(response.status).toBe(200);
    expect(AdminScanSchema.parse(((await response.json()) as { scan: unknown }).scan)).toEqual(SCAN);

    const missing = createTestApp({ getScan: async () => null });
    await expectErrorCode(await missing.app.request(ADMIN_ROUTES.scan(SCAN_ID), { headers: asAdmin }), 404, 'NOT_FOUND');
  });

  it('фильтрПоУмолчаниюPending', async () => {
    const { app, store } = createTestApp();
    await app.request(ADMIN_ROUTES.scans, { headers: asAdmin });
    expect(store.listScans).toHaveBeenCalledWith({ filter: 'pending', limit: 20 });
  });

  it('неизвестныйФильтрИИспорченныйКурсор→400', async () => {
    const { app } = createTestApp();
    await expectErrorCode(await app.request(`${ADMIN_ROUTES.scans}?filter=всё`, { headers: asAdmin }), 400, 'INVALID_REQUEST');
    await expectErrorCode(await app.request(`${ADMIN_ROUTES.scans}?cursor=мусор`, { headers: asAdmin }), 400, 'INVALID_REQUEST');
  });

  it.each([
    { kind: 'confirm' },
    { kind: 'wine', slug: 'belbek-risling' },
    { kind: 'absent' },
  ])('действие %o сохраняется и возвращает скан', async (input) => {
    const { app, store } = createTestApp();
    const response = await app.request(ADMIN_ROUTES.scanTruth(SCAN_ID), {
      method: 'POST',
      headers: { ...asAdmin, 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { scan: unknown };
    expect(AdminScanSchema.parse(body.scan).id).toBe(SCAN_ID);
    expect(store.setTruth).toHaveBeenCalledWith(SCAN_ID, input);
  });

  it('мусорВТелеДействия→400', async () => {
    const { app } = createTestApp();
    for (const body of ['не json', JSON.stringify({ kind: 'что-то' }), JSON.stringify({ kind: 'wine' })]) {
      const response = await app.request(ADMIN_ROUTES.scanTruth(SCAN_ID), { method: 'POST', headers: asAdmin, body });
      await expectErrorCode(response, 400, 'INVALID_REQUEST');
    }
  });

  it.each([
    { status: 'scan_not_found', httpStatus: 404, code: 'NOT_FOUND' },
    { status: 'no_prediction', httpStatus: 400, code: 'INVALID_REQUEST' },
    { status: 'unknown_wine', httpStatus: 400, code: 'INVALID_REQUEST' },
  ] as const)('отказ разметки $status → $httpStatus', async ({ status, httpStatus, code }) => {
    const { app } = createTestApp({ setTruth: async () => ({ status }) });
    const response = await app.request(ADMIN_ROUTES.scanTruth(SCAN_ID), {
      method: 'POST',
      headers: asAdmin,
      body: JSON.stringify({ kind: 'confirm' }),
    });
    // Причина в details: клиент различает отказы, не разбирая текст сообщения.
    expect((await expectErrorCode(response, httpStatus, code)).details).toEqual({ reason: status });
  });

  it('фотоОтдаётсяСТипомПоСодержимому', async () => {
    const { app } = createTestApp();
    const response = await app.request(ADMIN_ROUTES.scanImage(SCAN_ID), { headers: asAdmin });
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/png');
    expect(response.headers.get('Cache-Control')).toContain('private');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PNG.bytes);
  });

  it('фотоНетНаДиске→404', async () => {
    const { app } = createTestApp({}, null);
    await expectErrorCode(await app.request(ADMIN_ROUTES.scanImage(SCAN_ID), { headers: asAdmin }), 404, 'NOT_FOUND');
  });

  it('сканаНетВБазе→фотоНеЧитаетсяВообще', async () => {
    const readImage = vi.fn(async () => PNG);
    const app = createApp({
      config: { corsOrigins: '*', recognizeTimeoutMs: 200, isAccessLogEnabled: false },
      recognizer: createMockRecognizer({ delayMs: 0 }),
      admin: {
        password: PASSWORD,
        store: { ...createTestApp().store, scanImagePath: async () => null },
        readImage,
      },
    });
    await expectErrorCode(await app.request(ADMIN_ROUTES.scanImage(SCAN_ID), { headers: asAdmin }), 404, 'NOT_FOUND');
    expect(readImage).not.toHaveBeenCalled();
  });

  it('поискПоКаталогуТребуетДваСимвола', async () => {
    const { app, store } = createTestApp();
    await expectErrorCode(await app.request(`${ADMIN_ROUTES.wines}?q=б`, { headers: asAdmin }), 400, 'INVALID_REQUEST');
    expect(store.searchWines).not.toHaveBeenCalled();

    const response = await app.request(`${ADMIN_ROUTES.wines}?q=бельбек`, { headers: asAdmin });
    expect(response.status).toBe(200);
    expect(AdminWineSearchSchema.parse(await response.json()).items).toHaveLength(1);
    expect(store.searchWines).toHaveBeenCalledWith('бельбек', 8);
  });
});
