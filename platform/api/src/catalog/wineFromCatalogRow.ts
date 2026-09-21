import type { Wine, WineColor, WineSweetness } from '@winvino/contract';

/**
 * Строка каталога в той форме, в какой её отдаёт SELECT по wines + manufacturers +
 * regions + агрегаты wine_grapes/wine_dishes. numeric из pg приходит строкой.
 */
export type CatalogWineRow = {
  id: string;
  slug: string;
  title: string;
  category_name: string | null;
  wine_color: string | null;
  sweetness: string | null;
  hue: string | null;
  public_rating: string | null;
  alcohol: string | null;
  serve_temperature: string | null;
  description: string | null;
  image_url: string | null;
  vintage: number | null;
  manufacturer_slug: string | null;
  manufacturer_name: string | null;
  region_name: string | null;
  grapes: string[];
  dishes: string[];
};

// Значения wines.wine_color / wines.sweetness — ровно те, что есть в каталоге (docs/DATABASE.md).
const COLOR_BY_CATALOG_VALUE: Record<string, WineColor> = {
  Белое: 'white',
  Красное: 'red',
  Розовое: 'rose',
  Оранжевое: 'orange',
};

const SWEETNESS_BY_CATALOG_VALUE: Record<string, WineSweetness> = {
  сухое: 'dry',
  полусухое: 'semi_dry',
  полусладкое: 'semi_sweet',
  сладкое: 'sweet',
  брют: 'brut',
  'экстра брют': 'extra_brut',
};

/** В каталоге есть опечатки вида 135.0 вместо 13.5 — крепче креплёных вин не бывает. */
const MAX_PLAUSIBLE_ALCOHOL_PERCENT = 25;

/** Прямой путь к картинке каталога отдаёт 404, работает только ресайзер. Бокс под бутылку. */
const CATALOG_IMAGE_RESIZER_URL = 'https://api.vino-svoe.ru/v1/img/str-api/480/960/resize';
const CATALOG_WINE_PAGE_URL = 'https://vino-svoe.ru/wines';

/** «10-12», «16–18» (с тире), «8» → диапазон в °C. */
export function parseServingTemperature(raw: string | null): Wine['servingTemperatureC'] {
  const match = raw?.trim().match(/^(\d+)(?:\s*[-–—]\s*(\d+))?$/);
  if (!match?.[1]) return null;
  const min = Number(match[1]);
  const max = match[2] ? Number(match[2]) : min;
  return min <= max ? { min, max } : { min: max, max: min };
}

function parseAlcoholPercent(raw: string | null): number | null {
  if (raw === null) return null;
  const alcohol = Number(raw);
  return Number.isFinite(alcohol) && alcohol > 0 && alcohol <= MAX_PLAUSIBLE_ALCOHOL_PERCENT ? alcohol : null;
}

function trimmedOrNull(raw: string | null): string | null {
  const trimmed = raw?.trim();
  return trimmed ? trimmed : null;
}

export function wineFromCatalogRow(row: CatalogWineRow): Wine {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title.trim(),
    manufacturer:
      row.manufacturer_slug && row.manufacturer_name
        ? { slug: row.manufacturer_slug, name: row.manufacturer_name.trim() }
        : null,
    region: row.region_name ? { name: row.region_name.trim() } : null,
    color: (row.wine_color && COLOR_BY_CATALOG_VALUE[row.wine_color]) || null,
    sweetness: (row.sweetness && SWEETNESS_BY_CATALOG_VALUE[row.sweetness]) || null,
    categoryLabel: trimmedOrNull(row.category_name),
    hue: trimmedOrNull(row.hue),
    grapes: row.grapes,
    pairings: row.dishes,
    alcoholPercent: parseAlcoholPercent(row.alcohol),
    servingTemperatureC: parseServingTemperature(row.serve_temperature),
    vintage: row.vintage,
    rating: row.public_rating === null ? null : Number(row.public_rating),
    description: trimmedOrNull(row.description),
    imageUrl: row.image_url ? `${CATALOG_IMAGE_RESIZER_URL}${row.image_url}` : null,
    catalogUrl: `${CATALOG_WINE_PAGE_URL}/${encodeURIComponent(row.slug)}`,
  };
}
