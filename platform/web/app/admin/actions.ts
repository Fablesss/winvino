"use server";

import { AdminTruthInputSchema } from "@winvino/contract";
import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";
import { AdminApiError, submitTruth } from "@/lib/adminApi";
import { ADMIN_LOGIN_PATH, endAdminSession, requireAdminSession, startAdminSession } from "@/lib/adminGuard";
import { adminPassword, isAdminPassword } from "@/lib/adminSession";

const QUEUE_PATH = "/admin";

/**
 * Куда вернуться после действия. Значение приходит из скрытого поля формы, то есть от клиента,
 * поэтому за пределы раздела уйти не даём: иначе кнопка «Верно» становится открытым редиректом.
 */
function safeReturnPath(value: FormDataEntryValue | null): string {
  const path = typeof value === "string" ? value : "";
  const isInsideAdmin = path.startsWith(`${QUEUE_PATH}?`) || path === QUEUE_PATH || path.startsWith(`${QUEUE_PATH}/`);
  return isInsideAdmin && !path.includes("//") && !path.includes("\\") ? path : QUEUE_PATH;
}

function withFailure(path: string, failure: string): string {
  const [pathname, search] = path.split("?");
  const params = new URLSearchParams(search);
  params.set("error", failure);
  return `${pathname}?${params}`;
}

export async function signIn(formData: FormData): Promise<void> {
  const password = adminPassword();
  if (!password) notFound();
  if (!isAdminPassword(String(formData.get("password") ?? ""), password)) {
    redirect(`${ADMIN_LOGIN_PATH}?error=1`);
  }
  await startAdminSession(password);
  redirect(QUEUE_PATH);
}

export async function signOut(): Promise<void> {
  await endAdminSession();
  redirect(ADMIN_LOGIN_PATH);
}

/**
 * Три действия разметчика одной формой: kind решает, что именно записать. Ошибку не показываем
 * текстом с сервера, а возвращаем коротким кодом в адресе — страница знает, как его назвать.
 */
export async function markTruth(formData: FormData): Promise<void> {
  await requireAdminSession();
  const scanId = String(formData.get("scanId") ?? "");
  const kind = String(formData.get("kind") ?? "");
  const back = safeReturnPath(formData.get("back"));
  const input = AdminTruthInputSchema.safeParse(
    kind === "wine" ? { kind, slug: String(formData.get("slug") ?? "") } : { kind },
  );
  if (!input.success) redirect(withFailure(back, "failed"));

  try {
    await submitTruth(scanId, input.data);
  } catch (error) {
    redirect(withFailure(back, error instanceof AdminApiError ? error.failure : "failed"));
  }
  revalidatePath(QUEUE_PATH);
  redirect(back);
}
