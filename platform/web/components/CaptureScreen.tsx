import type { InstallOption } from "@/lib/pwa";
import { ActionButton } from "./ActionButton";

type CaptureScreenProps = {
  onTakePhoto: () => void;
  onChooseFromGallery: () => void;
  installOption: InstallOption;
};

/** Условная этикетка в видоискателе: показывает, что именно снимать и как крупно. */
function LabelInViewfinder() {
  return (
    <svg viewBox="0 0 240 250" className="mx-auto w-full max-w-[15rem] text-ink" role="img" aria-label="Этикетка в кадре целиком">
      <g stroke="currentColor" strokeWidth="3" fill="none" strokeLinecap="round" className="text-action">
        <path d="M6 34V6h28M206 6h28v28M234 216v28h-28M34 244H6v-28" />
      </g>
      <g stroke="currentColor" fill="none" opacity="0.8">
        <rect x="40" y="38" width="160" height="174" rx="3" strokeWidth="1.5" />
        <rect x="48" y="46" width="144" height="158" rx="1.5" strokeWidth="0.75" />
        <path d="M104 170h32" strokeWidth="0.75" />
      </g>
      <g fill="currentColor" textAnchor="middle" className="font-label">
        <text x="120" y="82" fontSize="11" opacity="0.7">Крым</text>
        <text x="120" y="126" fontSize="23">Бельбек</text>
        <text x="120" y="152" fontSize="13">Рислинг Резерв</text>
        <text x="120" y="190" fontSize="10" opacity="0.7">белое сухое</text>
      </g>
    </svg>
  );
}

function InstallHint({ installOption }: { installOption: InstallOption }) {
  if (installOption.kind === "prompt") {
    return (
      <ActionButton variant="secondary" onClick={() => void installOption.install()}>
        Установить приложение
      </ActionButton>
    );
  }
  if (installOption.kind === "iosHint") {
    return (
      <p className="px-4 pt-2 text-center text-sm text-hint">
        Чтобы открывать с экрана «Домой», нажмите «Поделиться» и выберите «На экран Домой».
      </p>
    );
  }
  return null;
}

export function CaptureScreen({ onTakePhoto, onChooseFromGallery, installOption }: CaptureScreenProps) {
  return (
    <>
      <header className="pt-[max(1.25rem,env(safe-area-inset-top))]">
        <p className="font-label text-xl">winvino</p>
      </header>

      <main className="flex flex-1 flex-col justify-center gap-8 py-8">
        <div>
          <h1 className="text-[2rem] leading-[1.15] font-semibold tracking-[-0.01em] text-balance">Узнайте вино по этикетке</h1>
          <p className="mt-3 max-w-[34ch] text-[1.0625rem] leading-relaxed text-hint">
            Снимите лицевую этикетку российского вина — покажем винодельню, сорт, регион и как его подавать.
          </p>
        </div>
        <LabelInViewfinder />
        <p className="text-center text-sm text-hint">Этикетка — почти во весь кадр, без бликов.</p>
      </main>

      <footer className="sticky bottom-0 flex flex-col gap-1 bg-paper pt-3 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        <ActionButton variant="primary" onClick={onTakePhoto}>
          Сфотографировать этикетку
        </ActionButton>
        <ActionButton variant="secondary" onClick={onChooseFromGallery}>
          Выбрать фото из галереи
        </ActionButton>
        <InstallHint installOption={installOption} />
      </footer>
    </>
  );
}
