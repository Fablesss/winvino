/* eslint-disable @next/next/no-img-element -- blob:-превью своего же снимка, оптимизатору Next тут нечего делать */

export function ProcessingScreen({ previewUrl }: { previewUrl: string }) {
  return (
    <main className="flex flex-1 flex-col justify-center gap-6 py-[max(1.5rem,env(safe-area-inset-top))]" aria-busy="true">
      <div className="relative mx-auto aspect-[3/4] w-full max-w-xs overflow-hidden rounded-4xl bg-surface">
        <img src={previewUrl} alt="Ваш снимок этикетки" className="h-full w-full object-cover" />
        <div className="label-scan-beam pointer-events-none absolute inset-0" aria-hidden />
      </div>
      <p className="text-center text-lg" role="status">
        Читаем этикетку…
      </p>
    </main>
  );
}
