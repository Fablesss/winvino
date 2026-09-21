import type { Recognition, Wine } from '../src/index.ts';

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
  alcoholPercent: 13,
  servingTemperatureC: { min: 10, max: 12 },
  vintage: null,
  rating: 5,
  description: 'Аромат утончённый — белые цветы, зелёное яблоко.',
  imageUrl: 'https://api.vino-svoe.ru/v1/img/str-api/480/960/resize/uploads/belbek.webp',
  catalogUrl: 'https://vino-svoe.ru/wines/belbek-belbek-risling-rezerv-beloe-suhoe-13',
};

export const sampleMatched: Recognition = {
  id: '0f7a3c52-8a0e-4b8e-9d2a-3c1f7f0b9a11',
  status: 'matched',
  reason: null,
  match: { wine: sampleWine, confidence: 0.93 },
  alternatives: [],
  processingMs: 812,
  createdAt: '2026-09-21T10:00:00.000Z',
};
