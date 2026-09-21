/* eslint-disable @next/next/no-img-element -- blob:-превью своего же снимка */
"use client";

import type { NotFoundReason, Recognition, WineCandidate } from "@winvino/contract";
import { useEffect, useId, useState } from "react";
import { describeOrigin, formatConfidence } from "@/lib/wineFacts";
import { ActionButton } from "./ActionButton";
import { WineCard, wineSwatchClass } from "./WineCard";

type RecognitionScreenProps = {
  recognition: Recognition;
  previewUrl: string;
  onRetake: () => void;
  /** null — кнопку на странице не показываем: внутри Telegram её роль играет MainButton. */
  onBackToCapture: (() => void) | null;
  backToCaptureLabel: string;
  onOpenLink: (url: string) => void;
};

const NOT_FOUND_COPY: Record<NotFoundReason, { title: string; hint: string; retakeLabel: string }> = {
  unreadable: {
    title: "Не удалось прочитать этикетку",
    hint: "Снимите ближе и без бликов: текст этикетки должен быть чётким и занимать почти весь кадр.",
    retakeLabel: "Переснять",
  },
  not_in_catalog: {
    title: "Этого вина нет в каталоге",
    hint: "Пока мы узнаём только российские вина из каталога vino-svoe.ru.",
    retakeLabel: "Сфотографировать другое",
  },
};

function BackToCaptureFooter({ onBackToCapture, label }: { onBackToCapture: (() => void) | null; label: string }) {
  if (!onBackToCapture) return null;
  return (
    // Под кнопку уезжает длинная карточка — линия сверху делает срез текста намеренным.
    // На всю ширину экрана (-mx-5): иначе при дробном DPR видны швы по краям sticky-слоя.
    <footer className="sticky bottom-0 -mx-5 mt-8 border-t border-line bg-paper px-5 pt-3 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
      <ActionButton variant="primary" onClick={onBackToCapture}>
        {label}
      </ActionButton>
    </footer>
  );
}

function CandidateRow({ candidate, onSelect }: { candidate: WineCandidate; onSelect: () => void }) {
  const origin = describeOrigin(candidate.wine);
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        className="flex w-full items-center gap-4 py-3.5 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action"
      >
        <span className={`h-10 w-10 shrink-0 rounded-full ${wineSwatchClass(candidate.wine)}`} aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block font-label text-lg leading-tight">{candidate.wine.title}</span>
          {origin && <span className="mt-0.5 block truncate text-sm text-hint">{origin}</span>}
        </span>
        <span className="shrink-0 text-sm text-hint tabular-nums">{formatConfidence(candidate.confidence)}</span>
      </button>
    </li>
  );
}

function FoundWine({
  recognition,
  onBackToCapture,
  backToCaptureLabel,
  onOpenLink,
}: RecognitionScreenProps & { recognition: Extract<Recognition, { match: WineCandidate }> }) {
  const headingId = useId();
  const candidates = [recognition.match, ...recognition.alternatives];
  const [selectedIndex, setSelectedIndex] = useState(0);
  const selected = candidates[selectedIndex] ?? recognition.match;
  const isUnsureAboutSelected = recognition.status === "ambiguous" && selectedIndex === 0;

  // Выбрали другое вино из списка — карточка сменилась наверху, туда и уводим взгляд и фокус.
  useEffect(() => {
    document.getElementById(headingId)?.focus({ preventScroll: true });
    window.scrollTo({ top: 0 });
  }, [headingId, selectedIndex]);

  return (
    <>
      <main className="pt-[max(1.25rem,env(safe-area-inset-top))]">
        <p className="mb-3 text-sm text-hint" role="status">
          {isUnsureAboutSelected
            ? `Не уверены — похоже на это вино (${formatConfidence(selected.confidence)}). Если не оно, посмотрите похожие ниже.`
            : `Совпадение ${formatConfidence(selected.confidence)}`}
        </p>
        <WineCard wine={selected.wine} headingId={headingId} onOpenLink={onOpenLink} />

        {candidates.length > 1 && (
          <section className="mt-10" aria-labelledby={`${headingId}-others`}>
            <h2 id={`${headingId}-others`} className="text-lg font-semibold">
              {recognition.status === "ambiguous" ? "Похожие вина" : "Не то вино?"}
            </h2>
            <ul className="mt-2 divide-y divide-line border-y border-line">
              {candidates.map((candidate, index) =>
                index === selectedIndex ? null : (
                  <CandidateRow key={candidate.wine.id} candidate={candidate} onSelect={() => setSelectedIndex(index)} />
                ),
              )}
            </ul>
          </section>
        )}
      </main>
      <BackToCaptureFooter onBackToCapture={onBackToCapture} label={backToCaptureLabel} />
    </>
  );
}

function WineNotFound({
  reason,
  previewUrl,
  onRetake,
  onBackToCapture,
  backToCaptureLabel,
}: Omit<RecognitionScreenProps, "recognition"> & { reason: NotFoundReason }) {
  const copy = NOT_FOUND_COPY[reason];
  return (
    <>
      <main className="flex flex-1 flex-col justify-center gap-5 py-8">
        <img src={previewUrl} alt="Ваш снимок" className="aspect-[3/4] w-28 rounded-2xl bg-surface object-cover" />
        <h1 className="text-[1.75rem] leading-tight font-semibold text-balance" tabIndex={-1}>
          {copy.title}
        </h1>
        <p className="max-w-[36ch] text-[1.0625rem] leading-relaxed text-hint">{copy.hint}</p>
        <ActionButton variant="primary" onClick={onRetake}>
          {copy.retakeLabel}
        </ActionButton>
      </main>
      {onBackToCapture && (
        <footer className="pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          <ActionButton variant="secondary" onClick={onBackToCapture}>
            {backToCaptureLabel}
          </ActionButton>
        </footer>
      )}
    </>
  );
}

export function RecognitionScreen(props: RecognitionScreenProps) {
  const { recognition } = props;
  if (recognition.status === "not_found") return <WineNotFound {...props} reason={recognition.reason} />;
  return <FoundWine {...props} recognition={recognition} />;
}
