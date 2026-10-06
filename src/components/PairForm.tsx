"use client";
import { useState } from "react";
import { dict, pick, type Lang } from "@/lib/i18n";

type B = { slug: string; name_ar: string; name_en: string };

// One-time pairing of a kitchen tablet or TV with its branch.
export function PairForm({ lang, kind, branches }: { lang: Lang; kind: "kitchen" | "screen"; branches: B[] }) {
  const t = dict[lang].pair;
  const [branch, setBranch] = useState(branches[0]?.slug ?? "");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<"bad_pin" | "locked" | "server" | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/devices", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ branch, pin, kind }) }).catch(() => null);
    if (res?.ok) return location.reload();
    const err = (await res?.json().catch(() => null))?.error;
    setError(err === "bad_pin" || err === "locked" ? err : "server");
    setBusy(false);
  }

  return (
    <main className="night grid place-items-center p-4">
      <form onSubmit={submit} className="w-full max-w-sm grid gap-4 rounded-2xl bg-night-2 p-6">
        <h1 className="display text-3xl text-yellow">{t[kind]}</h1>
        <label className="grid gap-1 font-semibold">
          {t.branch}
          <select value={branch} onChange={(e) => setBranch(e.target.value)} className="night-input">
            {branches.map((b) => <option key={b.slug} value={b.slug}>{pick(b, lang)}</option>)}
          </select>
        </label>
        <label className="grid gap-1 font-semibold">
          {t.pin}
          <input value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} inputMode="numeric" type="password"
            autoComplete="off" maxLength={8} dir="ltr" className="night-input text-center text-2xl tracking-widest" />
        </label>
        {error && <p role="alert" className="font-semibold text-[#ff8a80]">{t[error]}</p>}
        <button type="submit" className="btn yellow" disabled={busy || pin.length < 4}>{t.submit}</button>
      </form>
    </main>
  );
}
