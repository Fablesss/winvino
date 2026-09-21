import type { Recognition, Wine, WineCandidate } from '@winvino/contract';

/** Узкие типы вариантов — чтобы в тестах менять поля спредом и не терять ветку union. */
type FoundRecognition = Extract<Recognition, { reason: null }>;
type NotFoundRecognition = Extract<Recognition, { status: 'not_found' }>;

export const sampleWine: Wine = {
  id: '5ada3598-60bc-4919-bb4d-5d5a47352894',
  slug: 'belbek-belbek-risling-rezerv-beloe-suhoe-13',
  title: 'Бельбек Рислинг Резерв',
  manufacturer: { slug: 'belbek', name: 'Бельбек' },
  region: { name: 'Крым' },
  color: 'white',
  sweetness: 'dry',
  categoryLabel: 'Белое сухое',
  hue: 'Светло-соломенный с золотистыми бликами',
  grapes: ['Рислинг'],
  pairings: ['Сыры', 'Рыба и морепродукты'],
  alcoholPercent: 13.5,
  servingTemperatureC: { min: 10, max: 12 },
  vintage: null,
  rating: 5,
  description: 'Аромат утончённый — белые цветы, зелёное яблоко.',
  imageUrl: 'https://api.vino-svoe.ru/v1/img/str-api/480/960/resize/uploads/belbek.webp',
  catalogUrl: 'https://vino-svoe.ru/wines/belbek-belbek-risling-rezerv-beloe-suhoe-13',
};

export const sampleAlternative: WineCandidate = {
  wine: {
    ...sampleWine,
    id: '9b2f0a4e-2c1d-4f7a-8e3b-6d5c4b3a2f10',
    slug: 'usadba-divnomorskoe-riesling',
    title: 'Усадьба Дивноморское «Рислинг & Co»',
    manufacturer: { slug: 'usadba-divnomorskoe', name: 'Усадьба Дивноморское' },
    region: { name: 'Краснодарский край' },
    catalogUrl: 'https://vino-svoe.ru/wines/usadba-divnomorskoe-riesling',
  },
  confidence: 0.21,
};

const recognitionMeta = {
  id: '0f7a3c52-8a0e-4b8e-9d2a-3c1f7f0b9a11',
  processingMs: 812,
  createdAt: '2026-09-21T10:00:00.000Z',
};

export const sampleMatched: FoundRecognition = {
  ...recognitionMeta,
  status: 'matched',
  reason: null,
  match: { wine: sampleWine, confidence: 0.93 },
  alternatives: [],
};

export const sampleAmbiguous: FoundRecognition = {
  ...recognitionMeta,
  status: 'ambiguous',
  reason: null,
  match: { wine: sampleWine, confidence: 0.64 },
  alternatives: [sampleAlternative],
};

export const sampleUnreadable: NotFoundRecognition = {
  ...recognitionMeta,
  status: 'not_found',
  reason: 'unreadable',
  match: null,
  alternatives: [],
};

export const sampleNotInCatalog: NotFoundRecognition = { ...sampleUnreadable, reason: 'not_in_catalog' };
