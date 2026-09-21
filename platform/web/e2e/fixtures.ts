import type { Recognition, Wine } from "@winvino/contract";
import sharp from "sharp";

const belbek: Wine = {
  id: "5ada3598-60bc-4919-bb4d-5d5a47352894",
  slug: "belbek-belbek-risling-rezerv-beloe-suhoe-13",
  title: "Бельбек Рислинг Резерв",
  manufacturer: { slug: "belbek", name: "Бельбек" },
  region: { name: "Крым" },
  color: "white",
  sweetness: "dry",
  categoryLabel: "Белое сухое",
  hue: "Светло-соломенный с золотистыми бликами",
  grapes: ["Рислинг"],
  pairings: ["Сыры", "Рыба и морепродукты"],
  alcoholPercent: 13,
  servingTemperatureC: { min: 10, max: 12 },
  vintage: null,
  rating: 5,
  description:
    "Аромат утончённый — белые цветы, зелёное яблоко, лёгкие нотки персика и цитруса; вкус с хрустящей кислотностью, минеральностью и долгим фруктовым послевкусием.",
  imageUrl: "https://api.vino-svoe.ru/v1/img/str-api/480/960/resize/uploads/belbek_belbek_risling_rezerv_beloe_suhoe_13_618fbe6775.webp",
  catalogUrl: "https://vino-svoe.ru/wines/belbek-belbek-risling-rezerv-beloe-suhoe-13",
};

const rubedo: Wine = {
  ...belbek,
  id: "2cee78b4-4120-4462-92f9-ef7c812b2285",
  slug: "valeriy-zaharin-rubedo-reserve-merlo-krasnoe-suhoe-13",
  title: "Rubedo. Reserve",
  manufacturer: { slug: "valeriy-zaharin", name: "Валерий Захарьин" },
  color: "red",
  categoryLabel: "Красное сухое",
  hue: "Глубокий рубиновый",
  grapes: ["Мерло"],
  servingTemperatureC: { min: 16, max: 18 },
  imageUrl: "https://api.vino-svoe.ru/v1/img/str-api/480/960/resize/uploads/valeriy_zaharin_rubedo_reserve_merlo_krasnoe_suhoe_13_bb611a1ce9.webp",
};

const recognitionMeta = { id: "0f7a3c52-8a0e-4b8e-9d2a-3c1f7f0b9a11", processingMs: 640, createdAt: "2026-09-21T10:00:00.000Z" };

export const RECOGNITIONS = {
  matched: {
    ...recognitionMeta,
    status: "matched",
    reason: null,
    match: { wine: belbek, confidence: 0.93 },
    alternatives: [{ wine: rubedo, confidence: 0.41 }],
  },
  ambiguous: {
    ...recognitionMeta,
    status: "ambiguous",
    reason: null,
    match: { wine: rubedo, confidence: 0.52 },
    alternatives: [{ wine: belbek, confidence: 0.47 }],
  },
  unreadable: { ...recognitionMeta, status: "not_found", reason: "unreadable", match: null, alternatives: [] },
} satisfies Record<string, Recognition>;

/** «Снимок этикетки» для загрузки в input: сама картинка моку безразлична, важен формат. */
export async function renderLabelPhoto(): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1200">
    <rect width="900" height="1200" fill="#5b4a3a"/>
    <rect x="170" y="220" width="560" height="760" rx="24" fill="#f3ead2"/>
    <text x="450" y="520" font-size="72" text-anchor="middle" font-family="Georgia" fill="#2b2b2b">Бельбек</text>
    <text x="450" y="610" font-size="44" text-anchor="middle" font-family="Georgia" fill="#2b2b2b">Рислинг Резерв</text>
    <text x="450" y="860" font-size="30" text-anchor="middle" font-family="Georgia" fill="#6b6b6b">Крым</text>
  </svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 88 }).toBuffer();
}
