/* eslint-disable @next/next/no-img-element -- фото бутылки уже ужато ресайзером каталога под этот бокс */
import type { Wine } from "@winvino/contract";
import type { MouseEvent } from "react";
import { describeOrigin, listWineFacts } from "@/lib/wineFacts";

export function wineSwatchClass(wine: Wine): string {
  return `wine-swatch-${wine.color ?? "unknown"}`;
}

type WineCardProps = {
  wine: Wine;
  headingId: string;
  onOpenLink: (url: string) => void;
};

export function WineCard({ wine, headingId, onOpenLink }: WineCardProps) {
  const origin = describeOrigin(wine);
  const facts = listWineFacts(wine);

  const openCatalog = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    onOpenLink(event.currentTarget.href);
  };

  return (
    <article aria-labelledby={headingId}>
      <figure>
        <div className={`flex h-80 items-end justify-center overflow-hidden rounded-[1.75rem] pt-6 ${wineSwatchClass(wine)}`}>
          {wine.imageUrl && (
            <img src={wine.imageUrl} alt={`Бутылка «${wine.title}»`} className="h-full w-auto max-w-[70%] object-contain object-bottom" />
          )}
        </div>
        {wine.hue && <figcaption className="mt-2 px-1 text-sm text-hint">{wine.hue}</figcaption>}
      </figure>

      <h1 id={headingId} tabIndex={-1} className="mt-6 font-label text-[2.125rem] leading-[1.12] text-balance outline-none">
        {wine.title}
      </h1>
      {origin && <p className="mt-2 text-[1.0625rem]">{origin}</p>}
      {wine.categoryLabel && <p className="mt-0.5 text-hint">{wine.categoryLabel}</p>}

      {facts.length > 0 && (
        <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-line pt-5">
          {facts.map((fact) => (
            <div key={fact.label}>
              <dt className="text-sm text-hint">{fact.label}</dt>
              <dd className="mt-0.5 text-[1.0625rem]">{fact.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {wine.description && <p className="mt-6 max-w-[60ch] text-[1.0625rem] leading-[1.6]">{wine.description}</p>}

      {wine.pairings.length > 0 && (
        <section className="mt-6" aria-labelledby={`${headingId}-pairings`}>
          <h2 id={`${headingId}-pairings`} className="text-sm text-hint">
            Сочетается с
          </h2>
          <ul className="mt-2 flex flex-wrap gap-2">
            {wine.pairings.map((pairing) => (
              <li key={pairing} className="rounded-full border border-line px-3 py-1 text-[0.9375rem]">
                {pairing}
              </li>
            ))}
          </ul>
        </section>
      )}

      {wine.catalogUrl && (
        <a
          href={wine.catalogUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={openCatalog}
          className="mt-6 inline-block text-link underline decoration-1 underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action"
        >
          Карточка вина на vino-svoe.ru
        </a>
      )}
    </article>
  );
}
