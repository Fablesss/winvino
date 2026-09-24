import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { wineFromCatalogRow } from '../src/catalog/wineFromCatalogRow.ts';
import { MOCK_CATALOG_ROWS } from '../src/recognizer/mockCatalog.ts';
import type { RecognitionOutcome } from '../src/recognizer/recognizer.ts';
import { createScanArchive, scanRow, type ScanRecord, type ScanRow } from '../src/scans/scanArchive.ts';
import { createFileScanStore } from '../src/scans/scanStorage.ts';

function wineAt(index: number) {
  const row = MOCK_CATALOG_ROWS[index];
  if (!row) throw new Error(`в мок-каталоге нет строки ${index}`);
  return wineFromCatalogRow(row);
}

/** Единственная запись — сразу и проверка, что их не больше одной. */
function only<T>(items: T[]): T {
  expect(items).toHaveLength(1);
  const [item] = items;
  if (!item) throw new Error('записей нет');
  return item;
}

const first = wineAt(0);
const second = wineAt(1);

const MATCHED: RecognitionOutcome = {
  status: 'ambiguous',
  reason: null,
  match: { wine: first, confidence: 0.62 },
  alternatives: [{ wine: second, confidence: 0.31 }],
};

const NOT_FOUND: RecognitionOutcome = { status: 'not_found', reason: 'unreadable', match: null, alternatives: [] };

function record(overrides: Partial<ScanRecord> = {}): ScanRecord {
  return {
    id: '3f1c1f2e-0000-4000-8000-000000000001',
    imageBytes: new TextEncoder().encode('label-photo-bytes'),
    imageMimeType: 'image/jpeg',
    outcome: MATCHED,
    processingMs: 412,
    recognizer: 'model',
    ...overrides,
  };
}

describe('scanRow', () => {
  it('fillsPredictionColumnsFromOutcome', () => {
    const row = scanRow(record(), 'siglip2-b16-ft1-e4');

    expect(row).toMatchObject({
      id: '3f1c1f2e-0000-4000-8000-000000000001',
      source: 'production',
      predictedWineSlug: first.slug,
      predictedScore: 0.62,
      matcherVersion: 'siglip2-b16-ft1-e4',
    });
    expect(row.candidates).toEqual({
      status: 'ambiguous',
      reason: null,
      top: [
        { slug: first.slug, confidence: 0.62 },
        { slug: second.slug, confidence: 0.31 },
      ],
      processingMs: 412,
      recognizer: 'model',
    });
  });

  it('keepsRefusalWithEmptyPrediction', () => {
    const row = scanRow(record({ outcome: NOT_FOUND }), 'model');

    expect(row.predictedWineSlug).toBeNull();
    expect(row.predictedScore).toBeNull();
    expect(row.candidates).toMatchObject({ status: 'not_found', reason: 'unreadable', top: [] });
  });

  it('namesFileByContentHashWithForwardSlashes', () => {
    const row = scanRow(record(), 'model');

    expect(row.imageSha256).toHaveLength(64);
    expect(row.imagePath).toBe(`production/${row.imageSha256.slice(0, 2)}/${row.imageSha256}.jpg`);
    expect(row.imagePath).not.toContain('\\');
    expect(scanRow(record({ imageMimeType: 'image/png' }), 'model').imagePath).toMatch(/\.png$/);
  });

  it('givesSamePathToSameBytesAndDifferentToOthers', () => {
    const same = scanRow(record(), 'model').imagePath;
    const other = scanRow(record({ imageBytes: new TextEncoder().encode('another-photo') }), 'model').imagePath;

    expect(scanRow(record({ id: 'other-id' }), 'model').imagePath).toBe(same);
    expect(other).not.toBe(same);
  });
});

describe('createScanArchive', () => {
  function createSpies() {
    const stored: string[] = [];
    const inserted: ScanRow[] = [];
    const logged: string[] = [];
    return {
      stored,
      inserted,
      logged,
      store: async (relativePath: string) => {
        stored.push(relativePath);
      },
      insert: async (row: ScanRow) => {
        inserted.push(row);
      },
      log: {
        error: (line: string) => {
          logged.push(line);
        },
      },
    };
  }

  it('savesImageThenRow', async () => {
    const spies = createSpies();

    await createScanArchive({ store: spies.store, insert: spies.insert, matcherVersion: 'v1', log: spies.log }).save(record());

    const row = only(spies.inserted);
    expect(only(spies.stored)).toBe(row.imagePath);
    expect(row.predictedWineSlug).toBe(first.slug);
    expect(spies.logged).toEqual([]);
  });

  it('skipsRowWhenImageCannotBeStored', async () => {
    const spies = createSpies();

    await createScanArchive({
      store: async () => {
        throw new Error('ENOSPC: диск полон');
      },
      insert: spies.insert,
      matcherVersion: 'v1',
      log: spies.log,
    }).save(record());

    expect(spies.inserted).toEqual([]);
    expect(only(spies.logged)).toContain('scan_image_save_failed');
  });

  it('swallowsDatabaseFailure', async () => {
    const spies = createSpies();

    await expect(
      createScanArchive({
        store: spies.store,
        insert: async () => {
          throw new Error('нет соединения с базой');
        },
        matcherVersion: 'v1',
        log: spies.log,
      }).save(record()),
    ).resolves.toBeUndefined();
    expect(only(spies.logged)).toContain('scan_row_save_failed');
  });
});

describe('createFileScanStore', () => {
  it('writesOnceAndIgnoresRepeatOfTheSameFrame', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'winvino-scans-'));
    const store = createFileScanStore(dir);
    const bytes = new TextEncoder().encode('photo');

    await store('production/ab/abc.jpg', bytes);
    await store('production/ab/abc.jpg', bytes);

    expect(await readFile(path.join(dir, 'production/ab/abc.jpg'))).toEqual(Buffer.from(bytes));
  });

  it('failsWhenDirectoryIsNotWritable', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'winvino-scans-'));
    const store = createFileScanStore(dir);
    await store('busy.jpg', new TextEncoder().encode('photo'));

    // Файл на месте каталога: mkdir упадёт — ровно тот сбой хранилища, который не должен дойти до клиента.
    await expect(store('busy.jpg/nested.jpg', new TextEncoder().encode('photo'))).rejects.toThrow();
  });
});
