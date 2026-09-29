import { fetchScanImage } from "@/lib/adminApi";
import { hasAdminSession } from "@/lib/adminGuard";

/**
 * Фото скана браузеру: единственный путь, которым снимок вообще покидает сеть контейнеров.
 * Гард здесь свой — роуты-обработчики не проходят ни через layout, ни через страницы.
 *
 * Без сессии отвечаем 404, а не 401: по прямой ссылке аноним не должен узнать даже то, что такой
 * скан существует. Токен API добавляет сервер, в браузер он не попадает.
 */
export async function GET(_request: Request, { params }: RouteContext<"/admin/scans/[id]/image">) {
  if (!(await hasAdminSession())) return new Response(null, { status: 404 });

  const { id } = await params;
  const upstream = await fetchScanImage(id);
  if (!upstream.ok || !upstream.body) return new Response(null, { status: 404 });

  return new Response(upstream.body, {
    headers: {
      "Content-Type": upstream.headers.get("Content-Type") ?? "application/octet-stream",
      // Фото неизменно (имя файла — хеш содержимого), но оно чужое: только приватный кеш.
      "Cache-Control": "private, max-age=300",
    },
  });
}
