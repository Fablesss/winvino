import {
  ADMIN_ROUTES,
  ADMIN_WINE_SEARCH_LIMIT,
  AdminScanPageSchema,
  AdminScanResultSchema,
  AdminWineSearchSchema,
  ApiErrorBodySchema,
  type AdminScan,
  type AdminScanPage,
  type AdminScanQuery,
  type AdminTruthInput,
  type AdminWineOption,
} from "@winvino/contract";
import { adminPassword } from "./adminSession";

/**
 * Серверная часть раздела разметки говорит с API напрямую и общим секретом — в браузер этот
 * заголовок не попадает никогда. Файл импортируется только из серверных компонентов и действий.
 *
 * Адрес API нужен в рантайме, а не при сборке (в отличие от rewrites в next.config.ts): в compose
 * это http://api:8787 из внутренней сети, и через публичный прокси /api/* тут ходить незачем.
 */
const API_BASE_URL = (process.env.WINVINO_API_URL ?? "http://127.0.0.1:8787").replace(/\/+$/, "");

/** Почему действие не прошло. Короткие коды, потому что уезжают в адресную строку. */
export const ADMIN_FAILURES = ["nopredict", "unknownwine", "gone", "failed"] as const;
export type AdminFailure = (typeof ADMIN_FAILURES)[number];

const FAILURE_BY_REASON: Record<string, AdminFailure> = {
  no_prediction: "nopredict",
  unknown_wine: "unknownwine",
  scan_not_found: "gone",
};

export class AdminApiError extends Error {
  constructor(readonly failure: AdminFailure, message: string) {
    super(message);
    this.name = "AdminApiError";
  }
}

async function adminFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const password = adminPassword();
  if (!password) throw new AdminApiError("failed", "Раздел разметки выключен: не задан ADMIN_PASSWORD.");
  return fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: { ...init.headers, Authorization: `Bearer ${password}` },
    // Очередь меняется на каждое действие разметчика — кешировать её нечем.
    cache: "no-store",
  });
}

/** Ошибку API превращаем в её же русское сообщение: они там написаны для показа человеку. */
async function toAdminError(response: Response): Promise<AdminApiError> {
  const body = ApiErrorBodySchema.safeParse(await response.json().catch(() => null));
  if (!body.success) return new AdminApiError("failed", `API ответил ${response.status}.`);
  const reason = body.data.error.details?.reason;
  const failure = (typeof reason === "string" ? FAILURE_BY_REASON[reason] : undefined) ?? "failed";
  return new AdminApiError(failure, body.data.error.message);
}

async function adminJson<T>(path: string, parse: (value: unknown) => T, init?: RequestInit): Promise<T> {
  const response = await adminFetch(path, init);
  if (!response.ok) throw await toAdminError(response);
  return parse(await response.json());
}

export function fetchScanQueue(query: Pick<AdminScanQuery, "filter"> & { cursor?: string }): Promise<AdminScanPage> {
  const search = new URLSearchParams({ filter: query.filter, ...(query.cursor ? { cursor: query.cursor } : {}) });
  return adminJson(`${ADMIN_ROUTES.scans}?${search}`, (value) => AdminScanPageSchema.parse(value));
}

/** null — скана нет: разметчик пришёл по старой ссылке. */
export async function fetchScan(scanId: string): Promise<AdminScan | null> {
  try {
    const { scan } = await adminJson(ADMIN_ROUTES.scan(scanId), (value) => AdminScanResultSchema.parse(value));
    return scan;
  } catch (error) {
    if (error instanceof AdminApiError && error.failure === "gone") return null;
    throw error;
  }
}

export async function searchWines(query: string): Promise<AdminWineOption[]> {
  const search = new URLSearchParams({ q: query, limit: String(ADMIN_WINE_SEARCH_LIMIT) });
  const { items } = await adminJson(`${ADMIN_ROUTES.wines}?${search}`, (value) => AdminWineSearchSchema.parse(value));
  return items;
}

export function submitTruth(scanId: string, input: AdminTruthInput): Promise<AdminScan> {
  return adminJson(
    ADMIN_ROUTES.scanTruth(scanId),
    (value) => AdminScanResultSchema.parse(value).scan,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) },
  );
}

/** Ответ отдаётся как есть — роут /admin/scans/[id]/image просто переливает байты браузеру. */
export function fetchScanImage(scanId: string): Promise<Response> {
  return adminFetch(ADMIN_ROUTES.scanImage(scanId));
}
