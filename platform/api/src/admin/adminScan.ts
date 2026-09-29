import {
  RECOGNITION_STATUSES,
  type AdminScan,
  type AdminScanCandidate,
  type AdminScanTruth,
  type AdminWineOption,
} from '@winvino/contract';

/** Строка label_scans в тех колонках, которые нужны очереди разметки. */
export type AdminScanRow = {
  id: string;
  created_at: Date;
  image_path: string;
  image_sha256: string | null;
  matcher_version: string | null;
  candidates: unknown;
  predicted_wine_slug: string | null;
  /** real из pg приходит числом, но пустая колонка — null. */
  predicted_score: number | string | null;
  truth_wine_slug: string | null;
  truth_absent: boolean;
  truth_rank: number | null;
};

/** Слаг → название: одним запросом по всем слагам страницы, а не join на каждый кандидат. */
export type WineTitles = ReadonlyMap<string, Pick<AdminWineOption, 'title' | 'manufacturerName'>>;

/**
 * Разбор candidates: структуру пишет scanArchive.ts (ScanCandidates), но в таблице лежит jsonb
 * без схемы — в ней и строки eval-набора, и прод-сканы прошлых версий. Поэтому каждое поле
 * достаётся отдельно и по отсутствию отдаётся null, а не роняет страницу разметчику.
 */
type ParsedCandidates = {
  status: AdminScan['status'];
  reason: string | null;
  processingMs: number | null;
  top: { slug: string; confidence: number }[];
};

function parseCandidates(raw: unknown): ParsedCandidates {
  const source = typeof raw === 'string' ? safeJsonParse(raw) : raw;
  const record = source && typeof source === 'object' ? (source as Record<string, unknown>) : {};
  const status = RECOGNITION_STATUSES.find((known) => known === record.status) ?? null;
  const top = Array.isArray(record.top)
    ? record.top.flatMap((item) => {
      const candidate = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
      const slug = typeof candidate.slug === 'string' ? candidate.slug : null;
      const confidence = Number(candidate.confidence);
      return slug ? [{ slug, confidence: Number.isFinite(confidence) ? confidence : 0 }] : [];
    })
    : [];
  return {
    status,
    reason: typeof record.reason === 'string' ? record.reason : null,
    processingMs: Number.isInteger(record.processingMs) ? (record.processingMs as number) : null,
    top,
  };
}

function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function wineOption(slug: string, titles: WineTitles): AdminWineOption {
  const known = titles.get(slug);
  return { slug, title: known?.title ?? null, manufacturerName: known?.manufacturerName ?? null };
}

function truthOf(row: AdminScanRow, titles: WineTitles): AdminScanTruth {
  if (row.truth_wine_slug) return { kind: 'wine', wine: wineOption(row.truth_wine_slug, titles) };
  if (row.truth_absent) return { kind: 'absent', wine: null };
  return { kind: 'none', wine: null };
}

/** Все слаги строки — чтобы вытащить названия одним запросом перед сборкой AdminScan. */
export function scanSlugs(row: AdminScanRow): string[] {
  const { top } = parseCandidates(row.candidates);
  return [row.predicted_wine_slug, row.truth_wine_slug, ...top.map((candidate) => candidate.slug)].filter(
    (slug): slug is string => slug !== null,
  );
}

export function adminScanFromRow(row: AdminScanRow, titles: WineTitles): AdminScan {
  const { status, reason, processingMs, top } = parseCandidates(row.candidates);
  const candidates: AdminScanCandidate[] = top.map((candidate) => ({
    ...wineOption(candidate.slug, titles),
    confidence: candidate.confidence,
  }));
  const predictedScore = row.predicted_score === null ? 0 : Number(row.predicted_score);
  return {
    id: row.id,
    createdAt: row.created_at.toISOString(),
    imageSha256: row.image_sha256,
    matcherVersion: row.matcher_version,
    status,
    reason,
    processingMs,
    predicted: row.predicted_wine_slug
      ? { ...wineOption(row.predicted_wine_slug, titles), confidence: predictedScore }
      : null,
    candidates,
    truth: truthOf(row, titles),
    truthRank: row.truth_rank,
  };
}

/**
 * Позиция эталона в топе распознавателя — та же метрика truth_rank, что у eval-набора
 * (миграция 20260913071710): 1 = top-1, null = правильного ответа в выдаче не было.
 * Считается при разметке, иначе размеченный прод-скан не сравнить с eval-строкой.
 */
export function truthRankIn(candidates: unknown, truthSlug: string | null): number | null {
  if (!truthSlug) return null;
  const position = parseCandidates(candidates).top.findIndex((candidate) => candidate.slug === truthSlug);
  return position < 0 ? null : position + 1;
}
