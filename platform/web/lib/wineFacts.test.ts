import type { Wine } from "@winvino/contract";
import { describe, expect, it } from "vitest";
import { describeOrigin, formatTemperatureRange, listWineFacts } from "./wineFacts";

const wine: Wine = {
  id: "5ada3598-60bc-4919-bb4d-5d5a47352894",
  slug: "belbek-belbek-risling-rezerv-beloe-suhoe-13",
  title: "Бельбек Рислинг Резерв",
  manufacturer: { slug: "belbek", name: "Бельбек" },
  region: { name: "Крым" },
  color: "white",
  sweetness: "dry",
  categoryLabel: "Белое сухое",
  hue: null,
  grapes: ["Рислинг"],
  pairings: [],
  alcoholPercent: 12.5,
  servingTemperatureC: { min: 10, max: 12 },
  vintage: null,
  rating: 4.25,
  description: null,
  imageUrl: null,
  catalogUrl: null,
};

describe("listWineFacts", () => {
  it("formatsInRussianConventions", () => {
    expect(listWineFacts(wine)).toEqual([
      { label: "Сорт", value: "Рислинг" },
      { label: "Крепость", value: "12,5 %" },
      { label: "Подавать при", value: "10–12 °C" },
      { label: "Рейтинг каталога", value: "4,3 из 5" },
    ]);
  });

  it("skipsMissingFacts", () => {
    expect(listWineFacts({ ...wine, grapes: [], alcoholPercent: null, servingTemperatureC: null, rating: null })).toEqual([]);
  });

  it("pluralizesSeveralGrapes", () => {
    expect(listWineFacts({ ...wine, grapes: ["Каберне Совиньон", "Мерло"] })[0]).toEqual({
      label: "Сорта",
      value: "Каберне Совиньон, Мерло",
    });
  });
});

describe("formatting helpers", () => {
  it("collapsesSingleTemperature", () => {
    expect(formatTemperatureRange({ min: 8, max: 8 })).toBe("8 °C");
  });

  it("describesOriginWithoutMissingParts", () => {
    expect(describeOrigin(wine)).toBe("Бельбек, Крым");
    expect(describeOrigin({ ...wine, region: null })).toBe("Бельбек");
    expect(describeOrigin({ ...wine, manufacturer: null, region: null })).toBeNull();
  });
});
