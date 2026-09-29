import { ADMIN_WINE_SEARCH_LIMIT, type AdminWineOption } from "@winvino/contract";
import { wineLabel } from "@/lib/adminView";
import { TruthButton } from "./TruthButton";

/** Короче — и в выдачу попадает половина каталога; порог тот же, что проверяет API. */
const MIN_QUERY_LENGTH = 2;

type WineSearchProps = {
  scanId: string;
  back: string;
  /** Что искали; пусто — поиска ещё не было. */
  query: string;
  results: AdminWineOption[];
};

/**
 * «На самом деле это»: обычная GET-форма на тот же адрес, поиск считает сервер. Так работает без
 * клиентского JS и без состояния — найденное вино сразу становится кнопкой, которая пишет эталон.
 */
export function WineSearch({ scanId, back, query, results }: WineSearchProps) {
  const isSearched = query.length >= MIN_QUERY_LENGTH;
  return (
    <section className="mt-6" data-testid="wine-search">
      <h2 className="text-lg">На самом деле это</h2>
      <form method="get" className="mt-2 flex gap-2">
        <input type="hidden" name="from" value={back} />
        <input
          type="search"
          name="q"
          defaultValue={query}
          placeholder="Название вина или винодельни"
          minLength={MIN_QUERY_LENGTH}
          required
          className="min-h-11 min-w-0 flex-1 rounded-xl border border-line bg-paper px-3 text-base placeholder:text-hint focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action"
        />
        <button
          type="submit"
          className="min-h-11 shrink-0 rounded-xl border border-line bg-surface px-4 text-sm font-semibold hover:border-action"
        >
          Найти
        </button>
      </form>

      {isSearched && results.length === 0 ? (
        <p className="mt-3 text-sm text-hint">Ничего не нашлось. Попробуйте другую часть названия.</p>
      ) : null}

      {results.length > 0 ? (
        <ul className="mt-3 space-y-2">
          {results.map((wine) => (
            <li key={wine.slug}>
              <TruthButton
                scanId={scanId}
                back={back}
                kind="wine"
                slug={wine.slug}
                tone="option"
                label={
                  <span className="block py-1">
                    <span className="block">{wineLabel(wine)}</span>
                    {wine.manufacturerName ? (
                      <span className="block text-xs font-normal text-hint">{wine.manufacturerName}</span>
                    ) : null}
                  </span>
                }
              />
            </li>
          ))}
        </ul>
      ) : null}

      {results.length === ADMIN_WINE_SEARCH_LIMIT ? (
        <p className="mt-2 text-xs text-hint">Показаны первые {ADMIN_WINE_SEARCH_LIMIT} — уточните запрос.</p>
      ) : null}
    </section>
  );
}
