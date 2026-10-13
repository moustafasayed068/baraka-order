"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { browserDb, saveOrder } from "@/lib/client";
import type { Tracking } from "@/lib/db";
import { dict, pick, type Lang, type OrderStatus } from "@/lib/i18n";

const FINAL = ["collected", "delivered", "not_collected", "cancelled"];
const STEP: Record<string, number> = { received: 0, preparing: 1, ready: 2, collected: 2 };
const DELIVERY_STEP: Record<string, number> = { received: 0, preparing: 1, ready: 1, out_for_delivery: 2, delivered: 3 };

function alertReady() {
  navigator.vibrate?.([300, 150, 300, 150, 600]);
  try {
    const ctx = new AudioContext();
    [0, 0.35, 0.7].forEach((at) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      o.frequency.value = 880;
      g.gain.setValueAtTime(0.2, ctx.currentTime + at);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + at + 0.3);
      o.start(ctx.currentTime + at); o.stop(ctx.currentTime + at + 0.3);
    });
  } catch {} // browsers may block sound without a recent tap; vibration and the green card still show
}

export function Tracker({ lang, token, initial }: { lang: Lang; token: string; initial: Tracking }) {
  const t = dict[lang];
  const [o, setO] = useState(initial);
  const [live, setLive] = useState(true);
  const prevStatus = useRef(initial.status);
  const done = FINAL.includes(o.status);

  useEffect(() => saveOrder({ token, number: initial.number, branch: initial.branch.slug, at: Date.parse(initial.created_at) }), [token, initial]);

  useEffect(() => {
    const alertOn = o.type === "delivery" ? "out_for_delivery" : "ready"; // the moment the customer needs to act
    if (prevStatus.current !== alertOn && o.status === alertOn) alertReady();
    prevStatus.current = o.status;
  }, [o.status, o.type]);

  // Realtime via broadcast topics keyed by the token (never the orders table); poll every 10 s if it drops.
  useEffect(() => {
    if (done) return;
    const refresh = () => fetch(`/api/track/${token}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((d) => d && setO(d)).catch(() => {});
    const db = browserDb();
    const ch = db
      .channel(`order:${token}`)
      .on("broadcast", { event: "status" }, refresh)
      .subscribe((s) => setLive(s === "SUBSCRIBED"));
    const branchCh = db.channel(`branch:${initial.branch.id}`).on("broadcast", { event: "changed" }, refresh).subscribe();
    const poll = setInterval(() => !navigator.onLine || ch.state !== "joined" ? refresh() : undefined, 10_000);
    // just back from the payment page: check often until the webhook confirms
    const payPoll = o.status === "awaiting_payment" ? setInterval(refresh, 3000) : undefined;
    const onVisible = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(poll);
      clearInterval(payPoll);
      document.removeEventListener("visibilitychange", onVisible);
      db.removeChannel(ch);
      db.removeChannel(branchCh);
    };
  }, [token, done, initial.branch.id, o.status]);

  const status = o.status as OrderStatus;
  const isDelivery = o.type === "delivery";
  const steps = isDelivery ? t.track.deliverySteps : t.track.steps;
  const step = (isDelivery ? DELIVERY_STEP : STEP)[o.status] ?? -1;
  const waiting = o.status === "received" || o.status === "preparing" || (isDelivery && o.status === "ready");
  const good = o.status === (isDelivery ? "delivered" : "ready") || o.status === "collected";

  return (
    <main className="track">
      {!live && !done && <p className="banner m-0!" role="status">{t.track.offline}</p>}
      <div className="ticket">
        <div className="text-sm opacity-90">{t.track.orderNo}</div>
        <div className="big num">{o.number}</div>
        <div className="font-semibold">{o.customer_name} · <span className="num">{o.total} {t.egp}</span></div>
      </div>

      <div className={`prog ${good ? "done" : ""}`} style={{ gridTemplateColumns: `repeat(${steps.length}, 1fr)` }}>
        {steps.map((s, i) => <div key={s} className={i <= step ? "on" : ""}>{s}</div>)}
      </div>

      <div className={`status-card ${o.status === "ready" || o.status === "out_for_delivery" ? "ready" : ""}`} role="status" aria-live="polite">
        <div className="s">{isDelivery && o.status === "ready" ? t.track.st.preparing : t.track.st[status]}</div>
        {waiting && <><div className="num">{t.track.ahead(o.ahead)}</div><div className="num">{t.track.eta(o.eta)}</div></>}
        {o.status === "ready" && !isDelivery && <div>{t.track.showNo}</div>}
        {o.rider && (
          <a href={`tel:${o.rider.phone}`} className="btn yellow mt-1">📞 {t.track.callRider}: {o.rider.name}</a>
        )}
        {o.status === "awaiting_payment" && (
          <>
            <div className="text-sm text-muted">{t.pay.confirming}</div>
            <Link href={`/pay/${token}`} className="btn mt-1">{t.pay.payNow(o.total)}</Link>
          </>
        )}
        {o.payment_status === "paid"
          ? <div className="text-sm font-bold text-ok">✓ {t.pay.paid}</div>
          : !done && o.status !== "awaiting_payment" && <div className="text-sm text-muted">{isDelivery ? t.track.payCod(o.total) : t.track.payCash(o.total)}</div>}
      </div>

      {o.address && (
        <div className="text-sm">
          <b>{t.track.deliverTo}:</b> {o.address.street}
          {o.address.building && ` · ${o.address.building}`}{o.address.floor && ` · ${o.address.floor}`}{o.address.apartment && ` · ${o.address.apartment}`}
          {o.address.landmark && <div className="text-muted">{o.address.landmark}</div>}
        </div>
      )}
      <div className="text-sm">
        <b>{t.track.branch}:</b> {pick(o.branch, lang)} · {lang === "ar" ? o.branch.address_ar : o.branch.address_en}
      </div>
      <ul className="m-0 ps-5 text-muted list-disc">
        {o.items.map((l, i) => (
          <li key={i}><span className="num">{l.qty}×</span> {pick(l, lang)}{l.option_ar && ` · ${lang === "ar" ? l.option_ar : l.option_en}`}</li>
        ))}
      </ul>
      <Link href={`/b/${o.branch.slug}`} className="btn alt">{t.track.newOrder}</Link>
    </main>
  );
}
