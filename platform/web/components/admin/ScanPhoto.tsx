/* eslint-disable @next/next/no-img-element -- /_next/image тянул бы фото сервером, без cookie разметчика, и получил бы 404 */

/**
 * Фото скана: отдаёт закрытый роут /admin/scans/[id]/image своего же origin, поэтому браузер
 * сам приложит cookie сессии. Оптимизатор Next тут не годится, да и нечего оптимизировать —
 * кадр уже ужат клиентом перед отправкой на распознавание.
 */
export function ScanPhoto({ scanId, className }: { scanId: string; className: string }) {
  return <img src={`/admin/scans/${scanId}/image`} alt="Снимок этикетки" className={className} loading="lazy" />;
}
