import type { AdminTruthInput } from "@winvino/contract";
import type { ReactNode } from "react";
import { markTruth } from "@/app/admin/actions";

const TONE_CLASSES = {
  primary: "px-3 bg-action text-action-ink hover:bg-action-hover",
  quiet: "px-3 border border-line bg-surface text-ink hover:border-action",
  /** Вариант из списка: во всю ширину и текстом слева, чтобы читался как строка выбора. */
  option: "w-full px-3 border border-line bg-paper text-left text-ink hover:border-action",
} as const;

type TruthButtonProps = {
  scanId: string;
  /** Куда вернуться после записи эталона. */
  back: string;
  kind: AdminTruthInput["kind"];
  /** Обязателен при kind="wine". */
  slug?: string;
  label: ReactNode;
  tone?: keyof typeof TONE_CLASSES;
};

/**
 * Одно действие разметчика = одна форма с server action. Без клиентского JS: раздел должен
 * работать с телефона по плохой сети, а тут хватает обычной отправки формы.
 */
export function TruthButton({ scanId, back, kind, slug, label, tone = "quiet" }: TruthButtonProps) {
  return (
    <form action={markTruth} className={tone === "option" ? "block" : "contents"}>
      <input type="hidden" name="scanId" value={scanId} />
      <input type="hidden" name="back" value={back} />
      <input type="hidden" name="kind" value={kind} />
      {slug ? <input type="hidden" name="slug" value={slug} /> : null}
      <button
        type="submit"
        className={`min-h-11 rounded-xl text-sm font-semibold transition-colors duration-200 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action ${TONE_CLASSES[tone]}`}
      >
        {label}
      </button>
    </form>
  );
}
