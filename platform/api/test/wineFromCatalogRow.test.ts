import { WineSchema } from '@winvino/contract';
import { describe, expect, it } from 'vitest';
import { parseServingTemperature, wineFromCatalogRow, type CatalogWineRow } from '../src/catalog/wineFromCatalogRow.ts';
import { MOCK_CATALOG_ROWS } from '../src/recognizer/mockCatalog.ts';

const baseRow = MOCK_CATALOG_ROWS[0] as CatalogWineRow;

describe('wineFromCatalogRow', () => {
  it('mapsEveryMockCatalogRowToContractValidWine', () => {
    for (const row of MOCK_CATALOG_ROWS) {
      expect(WineSchema.safeParse(wineFromCatalogRow(row)).error?.issues ?? [], row.slug).toEqual([]);
    }
  });

  it('translatesCatalogColorAndSweetnessToCodes', () => {
    const wine = wineFromCatalogRow({ ...baseRow, wine_color: 'Розовое', sweetness: 'экстра брют' });
    expect([wine.color, wine.sweetness]).toEqual(['rose', 'extra_brut']);
  });

  it('leavesUnknownCatalogValuesNull', () => {
    const wine = wineFromCatalogRow({ ...baseRow, wine_color: 'Зелёное', sweetness: null });
    expect([wine.color, wine.sweetness]).toEqual([null, null]);
  });

  it('dropsImplausibleAlcoholTypo', () => {
    expect(wineFromCatalogRow({ ...baseRow, alcohol: '135.0' }).alcoholPercent).toBeNull();
    expect(wineFromCatalogRow({ ...baseRow, alcohol: '18.0' }).alcoholPercent).toBe(18);
  });

  it('buildsResizerImageUrlBecauseDirectPathIs404', () => {
    const wine = wineFromCatalogRow({ ...baseRow, image_url: '/uploads/x.webp' });
    expect(wine.imageUrl).toBe('https://api.vino-svoe.ru/v1/img/str-api/480/960/resize/uploads/x.webp');
  });
});

describe('parseServingTemperature', () => {
  it.each([
    ['10-12', { min: 10, max: 12 }],
    ['16–18', { min: 16, max: 18 }],
    [' 8 - 10 ', { min: 8, max: 10 }],
    ['8', { min: 8, max: 8 }],
    ['18-16', { min: 16, max: 18 }],
    ['охлаждённым', null],
    [null, null],
  ])('parses %j', (raw, expected) => {
    expect(parseServingTemperature(raw)).toEqual(expected);
  });
});
