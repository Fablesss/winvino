import type { Wine } from "@winvino/contract";

const decimalFormat = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });

export type WineFact = { label: string; value: string };

/**
 * Факты для карточки в порядке, в каком их ищут у полки. Пустые поля пропускаются.
 * Рейтинга здесь нет: он показан бейджем на фото бутылки, как в каталоге.
 */
export function listWineFacts(wine: Wine): WineFact[] {
  const facts: Array<WineFact | null> = [
    wine.grapes.length > 0 ? { label: wine.grapes.length > 1 ? "Сорта" : "Сорт", value: wine.grapes.join(", ") } : null,
    wine.vintage !== null ? { label: "Урожай", value: String(wine.vintage) } : null,
    wine.alcoholPercent !== null ? { label: "Крепость", value: `${decimalFormat.format(wine.alcoholPercent)} %` } : null,
    wine.servingTemperatureC !== null ? { label: "Подавать при", value: formatTemperatureRange(wine.servingTemperatureC) } : null,
  ];
  return facts.filter((fact): fact is WineFact => fact !== null);
}

export function formatTemperatureRange({ min, max }: { min: number; max: number }): string {
  return min === max ? `${min} °C` : `${min}–${max} °C`;
}

export function formatConfidence(confidence: number): string {
  return `${Math.round(confidence * 100)} %`;
}

/** «Бельбек, Крым» — кто и где сделал вино. */
export function describeOrigin(wine: Wine): string | null {
  const parts = [wine.manufacturer?.name, wine.region?.name].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : null;
}
