import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { adminPassword } from "@/lib/adminSession";

export const metadata: Metadata = {
  title: "Разметка сканов · winvino",
  // Внутренний инструмент: ему нечего делать ни в поиске, ни в предпросмотре ссылок.
  robots: { index: false, follow: false },
};

/**
 * Раздел выключен (ADMIN_PASSWORD не задан) — его просто нет: 404 вместо формы входа, чтобы
 * снаружи не было видно даже того, что тут что-то есть. Проверка сессии — не здесь, а в каждой
 * странице и в роуте фото: layout в Next не перерисовывается при переходах и роуты не охраняет.
 */
export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  if (!adminPassword()) notFound();
  return <main className="mx-auto w-full max-w-2xl px-4 pt-[max(1.5rem,env(safe-area-inset-top))] pb-16">{children}</main>;
}
