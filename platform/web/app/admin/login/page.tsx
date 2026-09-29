import { ADMIN_PASSWORD_MIN_LENGTH } from "@winvino/contract";
import { redirect } from "next/navigation";
import { hasAdminSession } from "@/lib/adminGuard";
import { QUEUE_PATH, singleParam } from "@/lib/adminView";
import { signIn } from "../actions";

export default async function AdminLoginPage({ searchParams }: PageProps<"/admin/login">) {
  if (await hasAdminSession()) redirect(QUEUE_PATH);
  const failed = singleParam((await searchParams).error) !== undefined;

  return (
    <>
      <h1 className="text-2xl">Разметка сканов</h1>
      <p className="mt-2 text-sm text-hint">
        Внутренний раздел: очередь прод-сканов, которым нужно проставить эталон.
      </p>
      <form action={signIn} className="mt-6 space-y-3">
        <input
          type="password"
          name="password"
          autoComplete="current-password"
          minLength={ADMIN_PASSWORD_MIN_LENGTH}
          required
          autoFocus
          placeholder="Пароль раздела"
          aria-label="Пароль раздела"
          className="min-h-14 w-full rounded-2xl border border-line bg-surface px-4 text-base placeholder:text-hint focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action"
        />
        {failed ? (
          <p role="alert" className="text-sm text-action">
            Пароль не подошёл.
          </p>
        ) : null}
        <button
          type="submit"
          className="min-h-14 w-full rounded-2xl bg-action text-base font-semibold text-action-ink transition-colors duration-200 hover:bg-action-hover active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action"
        >
          Войти
        </button>
      </form>
    </>
  );
}
