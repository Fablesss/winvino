import type { AdminScan } from "@winvino/contract";
import Link from "next/link";
import { alternativesOf, confidencePercent, scanPath, scanTime, statusLabel, truthLabel, wineLabel } from "@/lib/adminView";
import { ScanPhoto } from "./ScanPhoto";
import { TruthButton } from "./TruthButton";

/**
 * Скан в очереди: снимок, что показали пользователю, и три действия. Частый случай — «Верно»,
 * поэтому он нажимается прямо из списка; выбор другого вина уводит на экран скана, где есть
 * поиск по каталогу и кандидаты целиком.
 */
export function ScanCard({ scan, back }: { scan: AdminScan; back: string }) {
  const alternatives = alternativesOf(scan);
  const truth = truthLabel(scan);
  return (
    <article className="rounded-2xl border border-line bg-surface p-3">
      <div className="flex gap-3">
        <Link href={scanPath(scan.id, back)} className="shrink-0">
          <ScanPhoto scanId={scan.id} className="h-32 w-24 rounded-xl border border-line object-cover" />
        </Link>
        <div className="min-w-0 flex-1">
          <p className="text-xs text-hint">
            {statusLabel(scan)}
            {scan.predicted ? ` · ${confidencePercent(scan.predicted.confidence)}` : ""}
          </p>
          {scan.predicted ? (
            <>
              <p className="truncate font-semibold">{wineLabel(scan.predicted)}</p>
              {scan.predicted.manufacturerName ? (
                <p className="truncate text-sm text-hint">{scan.predicted.manufacturerName}</p>
              ) : null}
            </>
          ) : (
            <p className="text-sm text-hint">Распознаватель ничего не назвал</p>
          )}

          {alternatives.length > 0 ? (
            <ul className="mt-2 space-y-0.5 text-sm text-hint">
              {alternatives.slice(0, 2).map((candidate) => (
                <li key={candidate.slug} className="truncate">
                  {wineLabel(candidate)} · {confidencePercent(candidate.confidence)}
                </li>
              ))}
            </ul>
          ) : null}

          {truth ? (
            <p className="mt-2 text-sm">
              <span className="text-hint">Эталон: </span>
              <span className="font-semibold">{truth}</span>
              {scan.truthRank ? <span className="text-hint"> · в топе {scan.truthRank}-й</span> : null}
            </p>
          ) : null}
        </div>
      </div>

      <p className="mt-2 text-xs text-hint">
        {scanTime(scan.createdAt)}
        {scan.matcherVersion ? ` · ${scan.matcherVersion}` : ""}
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        {scan.predicted ? (
          <TruthButton scanId={scan.id} back={back} kind="confirm" label="Верно" tone="primary" />
        ) : null}
        <TruthButton scanId={scan.id} back={back} kind="absent" label="Нет в каталоге" />
        <Link
          href={scanPath(scan.id, back)}
          className="flex min-h-11 items-center rounded-xl border border-line px-3 text-sm font-semibold text-link hover:border-action"
        >
          Другое вино →
        </Link>
      </div>
    </article>
  );
}
