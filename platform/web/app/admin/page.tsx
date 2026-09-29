import type { AdminScanFilter } from "@winvino/contract";
import Link from "next/link";
import { ScanCard } from "@/components/admin/ScanCard";
import { fetchScanQueue } from "@/lib/adminApi";
import { requireAdminSession } from "@/lib/adminGuard";
import { failureMessage, queuePath, singleParam } from "@/lib/adminView";
import { signOut } from "./actions";

const TABS: { filter: AdminScanFilter; label: string }[] = [
  { filter: "pending", label: "Без эталона" },
  { filter: "labeled", label: "Размеченные" },
];

export default async function AdminQueuePage({ searchParams }: PageProps<"/admin">) {
  await requireAdminSession();
  const params = await searchParams;
  const filter: AdminScanFilter = singleParam(params.filter) === "labeled" ? "labeled" : "pending";
  const cursor = singleParam(params.cursor);
  const error = failureMessage(singleParam(params.error));

  const page = await fetchScanQueue({ filter, cursor });
  // Тот же адрес, что открыт сейчас: действия возвращают разметчика на эту же страницу очереди.
  const back = queuePath({ filter, cursor });

  return (
    <>
      <header className="flex items-baseline gap-3">
        <h1 className="text-2xl">Разметка сканов</h1>
        <form action={signOut} className="ml-auto">
          <button type="submit" className="text-sm text-link hover:text-action-hover">
            Выйти
          </button>
        </form>
      </header>
      <p className="mt-1 text-sm text-hint">
        Без эталона: {page.pendingTotal}. Эталон нужен, чтобы скан пошёл в дообучение.
      </p>

      <nav className="mt-4 flex gap-2">
        {TABS.map((tab) => (
          <Link
            key={tab.filter}
            href={queuePath({ filter: tab.filter })}
            aria-current={tab.filter === filter ? "page" : undefined}
            className={`min-h-11 flex items-center rounded-xl px-3 text-sm font-semibold ${
              tab.filter === filter ? "bg-action text-action-ink" : "border border-line text-ink hover:border-action"
            }`}
          >
            {tab.label}
          </Link>
        ))}
      </nav>

      {error ? (
        <p role="alert" className="mt-4 rounded-xl border border-action bg-action-soft px-3 py-2 text-sm text-action">
          {error}
        </p>
      ) : null}

      {page.items.length === 0 ? (
        <p className="mt-6 text-sm text-hint">
          {filter === "pending"
            ? cursor
              ? "Дальше пусто — вернитесь к началу очереди."
              : "Очередь пуста: всем прод-сканам проставлен эталон."
            : "Размеченных сканов пока нет."}
        </p>
      ) : (
        <ul className="mt-4 space-y-3">
          {page.items.map((scan) => (
            <li key={scan.id}>
              <ScanCard scan={scan} back={back} />
            </li>
          ))}
        </ul>
      )}

      <nav className="mt-6 flex justify-between text-sm">
        {cursor ? (
          <Link href={queuePath({ filter })} className="text-link hover:text-action-hover">
            ← К началу
          </Link>
        ) : (
          <span />
        )}
        {page.nextCursor ? (
          <Link href={queuePath({ filter, cursor: page.nextCursor })} className="text-link hover:text-action-hover">
            Дальше →
          </Link>
        ) : null}
      </nav>
    </>
  );
}
