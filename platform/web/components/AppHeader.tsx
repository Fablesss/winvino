/* eslint-disable @next/next/no-img-element -- статичный svg-логотип из public, оптимизатору Next тут нечего делать */
import { ThemeToggle } from "./ThemeToggle";

/**
 * Шапка-«пилюля» с логотипом «Своё Вино» — как core-header__wrapper на vino-svoe.ru.
 * Логотип нарисован тёмным по кремовому, поэтому в тёмной теме показываем перекрашенный файл:
 * лишний вариант прячет CSS по data-theme, чтобы выбор слушался переключателя, а не только системы.
 */
export function AppHeader() {
  return (
    <header className="pt-[max(1.25rem,env(safe-area-inset-top))]">
      <div className="flex items-center gap-2 rounded-full bg-pill py-1.5 pr-1.5 pl-4 backdrop-blur-[10px]">
        <img src="/brand/svoe-vino-logo.svg" alt="Своё Вино — от Россельхозбанка" width={160} height={40} className="art-light h-8 w-auto" />
        <img src="/brand/svoe-vino-logo-dark.svg" alt="Своё Вино — от Россельхозбанка" width={160} height={40} className="art-dark h-8 w-auto" />
        <span className="ml-auto">
          <ThemeToggle />
        </span>
      </div>
    </header>
  );
}
