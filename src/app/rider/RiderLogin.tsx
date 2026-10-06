"use client";
import { useState } from "react";
import { AppHeadClient } from "./AppHeadClient";
import { dict, type Lang } from "@/lib/i18n";
import { normalizePhone } from "@/lib/phone";

export function RiderLogin({ lang }: { lang: Lang }) {
  const t = dict[lang].rider;
  const [phone, setPhone] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<"bad_login" | "locked" | "server" | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/rider/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone: normalizePhone(phone), pin }) }).catch(() => null);
    if (res?.ok) return location.reload();
    const err = (await res?.json().catch(() => null))?.error;
    setError(err === "bad_login" || err === "locked" ? err : "server");
    setBusy(false);
  }

  return (
    <div className="shell">
      <AppHeadClient lang={lang} />
      <form onSubmit={submit} className="grid gap-2 p-4">
        <h1 className="display text-3xl text-red">{t.login}</h1>
        <div className="field">
          <label htmlFor="r-phone">{t.phone}</label>
          <input id="r-phone" type="tel" inputMode="tel" autoComplete="tel" dir="ltr" maxLength={14} value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="r-pin">{t.pin}</label>
          <input id="r-pin" type="password" inputMode="numeric" autoComplete="current-password" dir="ltr" maxLength={8}
            value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} />
        </div>
        {error && <p className="alert" role="alert">{t[error]}</p>}
        <button type="submit" className="btn" disabled={busy || pin.length < 4 || normalizePhone(phone).length < 11}>{t.signIn}</button>
      </form>
    </div>
  );
}
