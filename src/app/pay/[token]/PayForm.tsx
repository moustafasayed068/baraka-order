"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { dict, type Lang } from "@/lib/i18n";

export function PayForm({ lang, token, total, enabled }: { lang: Lang; token: string; total: number; enabled: boolean }) {
  const t = dict[lang].pay;
  const router = useRouter();
  const [busy, setBusy] = useState<"pay" | "cash" | null>(null);
  const [msg, setMsg] = useState<string | null>(enabled ? null : t.off);

  async function go(action: "pay" | "cash") {
    setBusy(action);
    setMsg(null);
    const res = await fetch("/api/pay", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, action }),
    }).catch(() => null);
    const data = await res?.json().catch(() => null);
    if (res?.ok && action === "pay" && data?.url) {
      location.href = data.url; // Paymob's hosted checkout; it sends the customer back to the tracking page
      return;
    }
    if (res?.ok && action === "cash") return router.replace(`/t/${token}`);
    if (res?.status === 409) return router.replace(`/t/${token}`); // already paid / moved on
    setMsg(data?.error === "payments_off" ? t.off : t.failed);
    setBusy(null);
  }

  return (
    <div className="grid gap-2">
      {msg && <p className="alert" role="alert">{msg}</p>}
      <button type="button" className="btn" disabled={!enabled || !!busy} onClick={() => go("pay")}>
        {busy === "pay" ? t.opening : t.payNow(total)}
      </button>
      <button type="button" className="btn alt" disabled={!!busy} onClick={() => go("cash")}>{t.orCash}</button>
    </div>
  );
}
