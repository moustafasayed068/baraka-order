"use client";
import { useCallback, useRef, useState } from "react";
import type { RiderOrder } from "@/lib/db";
import { dict, pick, type Lang } from "@/lib/i18n";
import { useBranchLive } from "@/lib/staff-client";
import { AppHeadClient } from "./AppHeadClient";

type View = { orders: RiderOrder[]; cash: number; deliveredCount: number };
type Problem = "no_answer" | "wrong_address" | "refused";

const mapsUrl = (a: RiderOrder["address"]) =>
  a.lat !== null && a.lng !== null
    ? `https://www.google.com/maps/dir/?api=1&destination=${a.lat},${a.lng}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([a.street, a.building, a.landmark].filter(Boolean).join(" "))}`;

export function RiderBoard({ lang, rider, initial }: {
  lang: Lang; rider: { name: string; branchId: string; branch: { name_ar: string; name_en: string } }; initial: View;
}) {
  const t = dict[lang].rider;
  const [view, setView] = useState(initial);
  const [fetchOk, setFetchOk] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [problemFor, setProblemFor] = useState<string | null>(null);
  const seen = useRef(new Set(initial.orders.map((o) => o.id)));

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/rider", { cache: "no-store" });
      if (res.status === 401) return location.reload(); // shift ended or signed out
      if (!res.ok) throw new Error();
      const next: View = await res.json();
      if (next.orders.some((o) => !seen.current.has(o.id))) navigator.vibrate?.([200, 100, 200]); // new assignment
      next.orders.forEach((o) => seen.current.add(o.id));
      setView(next);
      setFetchOk(true);
    } catch {
      setFetchOk(false);
    }
  }, []);
  const live = useBranchLive(rider.branchId, refresh);

  async function act(orderId: string, body: { action: "picked_up" | "delivered" } | { action: "problem"; problem: Problem }) {
    setBusy(orderId);
    setProblemFor(null);
    await fetch("/api/rider", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderId, ...body }) }).catch(() => null);
    await refresh();
    setBusy(null);
  }

  async function signOut() {
    await fetch("/api/rider/session", { method: "DELETE" });
    location.reload();
  }

  return (
    <div className="shell">
      <AppHeadClient lang={lang}>
        <div className="load">
          <span><b>{rider.name}</b> · {pick(rider.branch, lang)}</span>
          <button type="button" className="underline" onClick={signOut}>{t.signOut}</button>
        </div>
        <div className="load">
          <span>{t.cash}: <b className="num">{view.cash} {dict[lang].egp}</b></span>
          <span className="num">{t.delivered(view.deliveredCount)}</span>
        </div>
      </AppHeadClient>
      {(!live || !fetchOk) && <p className="offline" role="alert">{dict[lang].kitchen.offline}</p>}

      <main className="menu">
        {view.orders.length === 0 && <p className="empty text-muted!">{t.none}</p>}
        {view.orders.map((o) => {
          const a = o.address;
          const out = o.status === "out_for_delivery";
          return (
            <article key={o.id} className="rcard">
              <div className="flex items-baseline justify-between">
                <span className="display text-4xl text-red num">#{o.number}</span>
                <span className={`ktag ${out ? "dark" : ""}`}>{out ? t.onTheWay : t.atBranch}</span>
              </div>
              <div className="text-lg font-bold">{o.customer_name} · <span dir="ltr" className="num">{o.customer_phone}</span></div>
              <div>
                {a.street}
                {a.building && ` · ${t.building} ${a.building}`}{a.floor && ` · ${t.floor} ${a.floor}`}{a.apartment && ` · ${t.apartment} ${a.apartment}`}
              </div>
              {a.landmark && <div className="text-muted">{a.landmark}</div>}
              <ul className="m-0 list-disc ps-5 text-sm">
                {o.items.map((l, i) => <li key={i}><span className="num">{l.qty}×</span> {pick(l, lang)}{l.option_ar && ` (${lang === "ar" ? l.option_ar : l.option_en})`}</li>)}
              </ul>
              <div className={`rcash ${o.payment_status === "paid" ? "paid" : ""}`}>{o.payment_status === "paid" ? t.paid : t.collect(o.total)}</div>
              {o.problem && <p className="alert m-0!">⚠ {t.problems[o.problem as Problem] ?? o.problem}</p>}

              <div className="grid grid-cols-2 gap-2">
                <a href={`tel:${o.customer_phone}`} className="btn alt">{t.call}</a>
                <a href={mapsUrl(a)} target="_blank" rel="noopener noreferrer" className="btn alt">{t.maps}</a>
              </div>
              {out ? (
                <button type="button" className="btn ok" disabled={busy === o.id}
                  onClick={() => (o.payment_status === "paid" || confirm(t.confirmDelivered(o.total))) && act(o.id, { action: "delivered" })}>
                  {t.deliveredBtn}
                </button>
              ) : (
                <button type="button" className="btn" disabled={busy === o.id} onClick={() => act(o.id, { action: "picked_up" })}>{t.pickedUp}</button>
              )}
              {problemFor === o.id ? (
                <div className="chips">
                  {(Object.keys(t.problems) as Problem[]).map((p) => (
                    <button key={p} type="button" className="chip" disabled={busy === o.id} onClick={() => act(o.id, { action: "problem", problem: p })}>{t.problems[p]}</button>
                  ))}
                </div>
              ) : (
                <button type="button" className="btn alt text-bad!" onClick={() => setProblemFor(o.id)}>⚠ {t.problem}</button>
              )}
            </article>
          );
        })}
      </main>
    </div>
  );
}
