/* eslint-disable @next/next/no-img-element -- blob:-превью своего же снимка */
import type { ApiErrorCode } from "@winvino/contract";
import type { DisplayError } from "@/lib/apiClient";
import { ActionButton } from "./ActionButton";

type FailureScreenProps = {
  error: DisplayError;
  previewUrl: string;
  onRetry: () => void;
  onRetake: () => void;
};

/** Фото с ошибкой формата/размера повторять бессмысленно — только переснять. */
const RETAKE_ONLY_CODES: ReadonlySet<string> = new Set<ApiErrorCode>([
  "IMAGE_TOO_LARGE",
  "UNSUPPORTED_IMAGE_TYPE",
  "IMAGE_UNREADABLE",
  "IMAGE_TOO_SMALL",
  "IMAGE_REQUIRED",
]);

export function FailureScreen({ error, previewUrl, onRetry, onRetake }: FailureScreenProps) {
  const canRetry = !RETAKE_ONLY_CODES.has(error.code);
  return (
    <main className="flex flex-1 flex-col justify-center gap-5 py-8" role="alert">
      <img src={previewUrl} alt="Ваш снимок" className="aspect-[3/4] w-28 rounded-3xl bg-surface object-cover" />
      <h1 className="text-[1.75rem]">Не получилось распознать</h1>
      <p className="max-w-[36ch] text-[1.0625rem] leading-relaxed">{error.message}</p>
      {error.requestId && <p className="text-sm text-hint">Номер запроса для поддержки: {error.requestId}</p>}
      <div className="flex flex-col gap-1">
        {canRetry && (
          <ActionButton variant="primary" onClick={onRetry}>
            Попробовать ещё раз
          </ActionButton>
        )}
        <ActionButton variant={canRetry ? "secondary" : "primary"} onClick={onRetake}>
          Переснять
        </ActionButton>
      </div>
    </main>
  );
}
