"use client";
import { useActionState } from "react";
import { dict, type Lang } from "@/lib/i18n";
import { signIn } from "../auth-actions";

export function LoginForm({ lang }: { lang: Lang }) {
  const t = dict[lang].admin;
  const [state, action, pending] = useActionState(signIn, null);
  return (
    <main className="shell p-4">
      <form action={action} className="grid gap-2">
        <h1 className="display text-3xl text-red">{t.login}</h1>
        <div className="field"><label htmlFor="email">{t.email}</label><input id="email" name="email" type="email" autoComplete="username" dir="ltr" required /></div>
        <div className="field"><label htmlFor="password">{t.password}</label><input id="password" name="password" type="password" autoComplete="current-password" dir="ltr" required /></div>
        {state?.error && <p className="alert" role="alert">{t[state.error as "badLogin" | "notStaff"]}</p>}
        <button type="submit" className="btn" disabled={pending}>{t.signIn}</button>
      </form>
    </main>
  );
}
