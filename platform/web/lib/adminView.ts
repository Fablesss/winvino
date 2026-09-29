import type { AdminScan, AdminScanCandidate, AdminScanFilter, AdminWineOption } from "@winvino/contract";

/** Показываем название, а если слага уже нет в зеркале каталога — сам слаг: он всё равно опознаётся. */
export function wineLabel(wine: AdminWineOption): string {
  return wine.title ?? wine.slug;
}

export function confidencePercent(confidence: number): string {
  return `${Math.round(confidence * 100)}%`;
}

const STATUS_LABEL: Record<NonNullable<AdminScan["status"]>, string> = {
  matched: "Уверенное совпадение",
  ambiguous: "Лучшая догадка",
  not_found: "Отказ",
};

const REASON_LABEL: Record<string, string> = {
  unreadable: "этикетку не прочитать",
  not_in_catalog: "нет в каталоге",
};

/** Что видел пользователь в приложении: без этого непонятно, ошибка это или честный отказ. */
export function statusLabel(scan: AdminScan): string {
  if (!scan.status) return "Без предсказания";
  const reason = scan.reason ? (REASON_LABEL[scan.reason] ?? scan.reason) : null;
  return reason ? `${STATUS_LABEL[scan.status]}: ${reason}` : STATUS_LABEL[scan.status];
}

/**
 * Время сканирования в московской зоне, а не в зоне сервера: контейнер живёт в UTC, и «13:40»
 * вместо «10:40» разметчику понятнее. Зона зафиксирована, поэтому сервер и браузер сходятся.
 */
const SCAN_TIME_FORMAT = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "long",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Moscow",
});

export function scanTime(createdAt: string): string {
  return SCAN_TIME_FORMAT.format(new Date(createdAt));
}

/** Альтернативы без лидера: он показан отдельной строкой и дублировать его в списке незачем. */
export function alternativesOf(scan: AdminScan): AdminScanCandidate[] {
  return scan.candidates.filter((candidate) => candidate.slug !== scan.predicted?.slug);
}

/** null — эталона ещё нет. */
export function truthLabel(scan: AdminScan): string | null {
  if (scan.truth.kind === "absent") return "Нет в каталоге";
  if (scan.truth.kind === "wine") return wineLabel(scan.truth.wine);
  return null;
}

/** Ошибки действий приходят коротким кодом в адресе — тут они превращаются в текст. */
const FAILURE_MESSAGE: Record<string, string> = {
  nopredict: "У этого скана нет предсказания: выберите вино сами или отметьте «нет в каталоге».",
  unknownwine: "Такого вина нет в каталоге — возможно, его сняли с продажи.",
  gone: "Скан не найден: похоже, его уже убрали из базы.",
  failed: "Не удалось сохранить. Попробуйте ещё раз.",
};

export function failureMessage(code: string | undefined): string | null {
  return code ? (FAILURE_MESSAGE[code] ?? FAILURE_MESSAGE.failed ?? null) : null;
}

export const QUEUE_PATH = "/admin";

/** Адрес очереди с сохранённым фильтром и страницей: он же «куда вернуться» после действия. */
export function queuePath(query: { filter: AdminScanFilter; cursor?: string }): string {
  const params = new URLSearchParams({ filter: query.filter, ...(query.cursor ? { cursor: query.cursor } : {}) });
  return `${QUEUE_PATH}?${params}`;
}

export function scanPath(scanId: string, back: string): string {
  return `${QUEUE_PATH}/scans/${scanId}?${new URLSearchParams({ from: back })}`;
}

/** Первое значение searchParams: Next отдаёт массив, если параметр пришёл дважды. */
export function singleParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
