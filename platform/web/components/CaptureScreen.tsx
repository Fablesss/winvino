/* eslint-disable @next/next/no-img-element -- статичная svg-иллюстрация из public, оптимизатору Next тут нечего делать */
import type { InstallOption } from "@/lib/pwa";
import { ActionButton } from "./ActionButton";
import { AppHeader } from "./AppHeader";

type CaptureScreenProps = {
  onTakePhoto: () => void;
  onChooseFromGallery: () => void;
  installOption: InstallOption;
};

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
      <AppHeader />

      <main className="flex flex-1 flex-col justify-center py-6">
        <h1 className="text-center text-[clamp(1.75rem,8.5vw,2.625rem)] text-balance">Узнайте вино по этикетке</h1>
        <p className="mx-auto mt-2 max-w-[34ch] text-center text-base leading-[1.5]">
          Снимите лицевую этикетку российского вина — покажем винодельню, сорт, регион и как его подавать.
        </p>

        {/* Блок сканирования с /wines: кремовая карточка, иллюстрация, кнопка и текстовая ссылка. */}
        <section className="mt-6 flex flex-col items-center rounded-3xl bg-surface px-8 pt-8 pb-6">
          <img src="/brand/scanner.svg" alt="Этикетка в кадре целиком" width={119} height={120} className="art-light" />
          <img src="/brand/scanner-dark.svg" alt="Этикетка в кадре целиком" width={119} height={120} className="art-dark" />
          <ActionButton variant="primary" className="mt-8" onClick={onTakePhoto}>
            Сфотографировать этикетку
          </ActionButton>
          <ActionButton variant="secondary" className="mt-2" onClick={onChooseFromGallery}>
            Загрузить фото
          </ActionButton>
        </section>

        <p className="mt-4 text-center text-sm text-hint">Этикетка — почти во весь кадр, без бликов.</p>
      </main>

      <footer className="pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        <InstallHint installOption={installOption} />
      </footer>
    </>
  );
}
