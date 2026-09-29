import Link from "next/link";
import { notFound } from "next/navigation";
import { ScanPhoto } from "@/components/admin/ScanPhoto";
import { TruthButton } from "@/components/admin/TruthButton";
import { WineSearch } from "@/components/admin/WineSearch";
import { fetchScan, searchWines } from "@/lib/adminApi";
import { requireAdminSession } from "@/lib/adminGuard";
import {
  alternativesOf,
  confidencePercent,
  failureMessage,
  QUEUE_PATH,
  scanTime,
  singleParam,
  statusLabel,
  truthLabel,
  wineLabel,
} from "@/lib/adminView";

const MIN_QUERY_LENGTH = 2;

/** Вернуться после действия только внутрь очереди: значение пришло из адреса, то есть от клиента. */
function safeFrom(value: string | undefined): string {
  return value?.startsWith(`${QUEUE_PATH}?`) || value === QUEUE_PATH ? value : QUEUE_PATH;
}

/**
 * Экран одного скана: снимок целиком и все способы проставить эталон — подтвердить предсказание,
 * выбрать любого кандидата одним нажатием, найти вино в каталоге или отметить «нет в каталоге».
 */
export default async function AdminScanPage({ params, searchParams }: PageProps<"/admin/scans/[id]">) {
  await requireAdminSession();
  const { id } = await params;
  const query = await searchParams;
  const back = safeFrom(singleParam(query.from));
  const search = singleParam(query.q)?.trim() ?? "";
  const error = failureMessage(singleParam(query.error));

  const scan = await fetchScan(id);
  if (!scan) notFound();

  const results = search.length >= MIN_QUERY_LENGTH ? await searchWines(search) : [];
  const truth = truthLabel(scan);

  return (
    <>
      <Link href={back} className="text-sm text-link hover:text-action-hover">
        ← К очереди
      </Link>

      <ScanPhoto scanId={scan.id} className="mt-3 max-h-[60vh] w-full rounded-2xl border border-line object-contain" />

      <p className="mt-3 text-xs text-hint">
        {scanTime(scan.createdAt)}
        {scan.matcherVersion ? ` · ${scan.matcherVersion}` : ""}
        {scan.processingMs !== null ? ` · ${scan.processingMs} мс` : ""}
      </p>
      <p className="text-sm text-hint">{statusLabel(scan)}</p>

      {truth ? (
        <p className="mt-3 rounded-xl border border-line bg-surface px-3 py-2 text-sm">
          <span className="text-hint">Эталон: </span>
          <span className="font-semibold">{truth}</span>
          <span className="text-hint"> — можно переразметить ниже.</span>
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="mt-3 rounded-xl border border-action bg-action-soft px-3 py-2 text-sm text-action">
          {error}
        </p>
      ) : null}

      {scan.predicted ? (
        <section className="mt-6">
          <h2 className="text-lg">Распознаватель считает</h2>
          <p className="mt-1 font-semibold">{wineLabel(scan.predicted)}</p>
          {scan.predicted.manufacturerName ? (
            <p className="text-sm text-hint">{scan.predicted.manufacturerName}</p>
          ) : null}
          <p className="text-sm text-hint">Уверенность {confidencePercent(scan.predicted.confidence)}</p>
          <div className="mt-3">
            <TruthButton scanId={scan.id} back={back} kind="confirm" label="Верно, это оно" tone="primary" />
          </div>
        </section>
      ) : (
        <p className="mt-6 text-sm text-hint">Распознаватель ничего не назвал — выберите вино сами.</p>
      )}

      {alternativesOf(scan).length > 0 ? (
        <section className="mt-6">
          <h2 className="text-lg">Другие кандидаты</h2>
          <ul className="mt-2 space-y-2">
            {alternativesOf(scan).map((candidate) => (
              <li key={candidate.slug}>
                <TruthButton
                  scanId={scan.id}
                  back={back}
                  kind="wine"
                  slug={candidate.slug}
                  tone="option"
                  label={
                    <span className="block py-1">
                      <span className="block">{wineLabel(candidate)}</span>
                      <span className="block text-xs font-normal text-hint">
                        {candidate.manufacturerName ? `${candidate.manufacturerName} · ` : ""}
                        {confidencePercent(candidate.confidence)}
                      </span>
                    </span>
                  }
                />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <WineSearch scanId={scan.id} back={back} query={search} results={results} />

      <section className="mt-6 border-t border-line pt-4">
        <TruthButton scanId={scan.id} back={back} kind="absent" label="Этого вина нет в каталоге" />
      </section>
    </>
  );
}
