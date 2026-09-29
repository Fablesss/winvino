import type { AdminScan } from "@winvino/contract";
import { describe, expect, it } from "vitest";
import { alternativesOf, confidencePercent, queuePath, scanPath, statusLabel, truthLabel, wineLabel } from "./adminView";

const SCAN: AdminScan = {
  id: "f2b9a4c1-0d3e-4a7b-9c11-8e5d6f2a3b40",
  createdAt: "2026-09-29T10:00:00.000Z",
  imageSha256: null,
  matcherVersion: "siglip2-b16-ft1-e4",
  status: "ambiguous",
  reason: null,
  processingMs: 640,
  predicted: { slug: "belbek-risling", title: "Бельбек Рислинг", manufacturerName: "Бельбек", confidence: 0.61 },
  candidates: [
    { slug: "belbek-risling", title: "Бельбек Рислинг", manufacturerName: "Бельбек", confidence: 0.61 },
    { slug: "zaharin-rubedo", title: "Rubedo. Reserve", manufacturerName: "Валерий Захарьин", confidence: 0.44 },
  ],
  truth: { kind: "none", wine: null },
  truthRank: null,
};

describe("wineLabel", () => {
  // Слаг мог исчезнуть из зеркала каталога — показать его всё равно лучше, чем пустую строку.
  it("падаетНаСлагБезНазвания", () => {
    expect(wineLabel({ slug: "snyato-s-prodazhi", title: null, manufacturerName: null })).toBe("snyato-s-prodazhi");
    expect(wineLabel({ slug: "belbek-risling", title: "Бельбек Рислинг", manufacturerName: null })).toBe("Бельбек Рислинг");
  });
});

describe("statusLabel", () => {
  it("называетЧтоВиделПользователь", () => {
    expect(statusLabel(SCAN)).toBe("Лучшая догадка");
    expect(statusLabel({ ...SCAN, status: "not_found", reason: "unreadable" })).toBe("Отказ: этикетку не прочитать");
    expect(statusLabel({ ...SCAN, status: null, reason: null })).toBe("Без предсказания");
  });

  it("незнакомуюПричинуПоказываетКакЕсть", () => {
    expect(statusLabel({ ...SCAN, status: "not_found", reason: "new_reason" })).toBe("Отказ: new_reason");
  });
});

describe("alternativesOf", () => {
  it("убираетЛидераИзСпискаАльтернатив", () => {
    expect(alternativesOf(SCAN).map((candidate) => candidate.slug)).toEqual(["zaharin-rubedo"]);
  });
});

describe("truthLabel", () => {
  it("различаетТриСостоянияЭталона", () => {
    expect(truthLabel(SCAN)).toBeNull();
    expect(truthLabel({ ...SCAN, truth: { kind: "absent", wine: null } })).toBe("Нет в каталоге");
    expect(
      truthLabel({
        ...SCAN,
        truth: { kind: "wine", wine: { slug: "belbek-risling", title: "Бельбек Рислинг", manufacturerName: "Бельбек" } },
      }),
    ).toBe("Бельбек Рислинг");
  });
});

describe("адреса очереди", () => {
  it("хранятФильтрИСтраницу", () => {
    expect(queuePath({ filter: "pending" })).toBe("/admin?filter=pending");
    expect(queuePath({ filter: "labeled", cursor: "2026-09-29T10:00:00.000Z|abc" })).toBe(
      "/admin?filter=labeled&cursor=2026-09-29T10%3A00%3A00.000Z%7Cabc",
    );
  });

  it("экранируютАдресВозврата", () => {
    expect(scanPath(SCAN.id, "/admin?filter=labeled")).toBe(
      `/admin/scans/${SCAN.id}?from=%2Fadmin%3Ffilter%3Dlabeled`,
    );
  });
});

describe("confidencePercent", () => {
  it("округляетДоЦелых", () => {
    expect(confidencePercent(0.614)).toBe("61%");
    expect(confidencePercent(1)).toBe("100%");
  });
});
