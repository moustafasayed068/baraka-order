"use client";
import { useActionState } from "react";
import { dict, type Lang } from "@/lib/i18n";
import { signOut, verifyMfa } from "../auth-actions";

export function MfaForm({ lang, factorId, qr, secret }: { lang: Lang; factorId: string; qr?: string; secret?: string }) {
  const t = dict[lang].admin;
  const [state, action, pending] = useActionState(verifyMfa, null);
  return (
    <main className="shell p-4">
      <form action={action} className="grid gap-3">
        <h1 className="display text-3xl text-red">{t.mfaTitle}</h1>
        <p className="text-muted">{t.mfaWhy}</p>
        {qr && (
          <>
            <p>{t.mfaSetup}</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qr} alt="" className="mx-auto h-52 w-52 rounded-lg bg-white p-2" />
            <p className="text-sm">{t.mfaSecret} <code dir="ltr" className="break-all">{secret}</code></p>
          </>
        )}
        {!qr && <><p>{t.mfaEnter}</p><p className="text-sm text-muted">{t.mfaLost}</p></>}
        <input type="hidden" name="factorId" value={factorId} />
        <div className="field">
          <label htmlFor="code">{t.mfaCode}</label>
          <input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} dir="ltr" required className="text-center text-2xl tracking-widest" />
        </div>
        {state?.error && <p className="alert" role="alert">{t.mfaBad}</p>}
        <button type="submit" className="btn" disabled={pending}>{t.mfaVerify}</button>
        <button type="button" className="btn alt" onClick={() => signOut()}>{t.signOut}</button>
      </form>
    </main>
  );
}
