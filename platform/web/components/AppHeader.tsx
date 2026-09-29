/**
 * Шапка-«пилюля» с логотипом «Своё Вино» — как core-header__wrapper на vino-svoe.ru.
 * Логотип нарисован тёмным по кремовому, поэтому в тёмной теме подставляем перекрашенный файл.
 */
export function AppHeader() {
  return (
    <header className="pt-[max(1.25rem,env(safe-area-inset-top))]">
      <div className="flex items-center rounded-full bg-pill px-4 py-2.5 backdrop-blur-[10px]">
        <picture>
          <source media="(prefers-color-scheme: dark)" srcSet="/brand/svoe-vino-logo-dark.svg" />
          <img src="/brand/svoe-vino-logo.svg" alt="Своё Вино — от Россельхозбанка" width={160} height={40} className="h-8 w-auto" />
        </picture>
      </div>
    </header>
  );
}
