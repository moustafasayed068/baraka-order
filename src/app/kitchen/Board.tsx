"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { LangToggle } from "@/components/LangToggle";
import type { BranchRider, DeviceBranch, KitchenOrder } from "@/lib/db";
import { store } from "@/lib/client";
import { dict, pick, type Lang } from "@/lib/i18n";
import { useBranchLive, useSound, useWakeLock } from "@/lib/staff-client";

type Action = "start" | "ready" | "collected" | "not_collected" | "assign" | "returned";
type Problem = keyof typeof dict.ar.kitchen.problem;
type MenuRow = { id: string; name_ar: string; name_en: string; sold_out: boolean };

const NO_SHOW_MIN = 30;
const minsSince = (iso: string, now: number) => Math.max(0, Math.floor((now - Date.parse(iso)) / 60_000));
// 75 → "1h 15m", 3000 → "2d"; under an hour stays plain minutes
function fmtAge(m: number, lang: Lang) {
  const [d, h, mi] = lang === "ar" ? ["ي", "س", "د"] : ["d", "h", "m"];
  if (m >= 1440) return `${Math.floor(m / 1440)}${d}`;
  if (m >= 60) return `${Math.floor(m / 60)}${h} ${m % 60}${mi}`;
  return `${m} ${dict[lang].kitchen.min}`;
}

export function Board({ lang, branch, initial, riders, serverNow }: {
  lang: Lang; branch: DeviceBranch; initial: KitchenOrder[]; riders: BranchRider[]; serverNow: number;
}) {
  const t = dict[lang].kitchen;
  const [orders, setOrders] = useState(initial);
  const [fetchOk, setFetchOk] = useState(true);
  const [now, setNow] = useState(serverNow); // start from the server's clock so the page hydrates cleanly
  const [unacked, setUnacked] = useState<number[]>([]); // new order numbers nobody has acknowledged yet
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuRow[] | null>(null);
  const [printQ, setPrintQ] = useState<KitchenOrder[]>([]); // receipts waiting to print, one at a time
  const [autoPrint, setAutoPrint] = useState(false);
  const autoPrintRef = useRef(false);
  const seen = useRef(new Set(initial.map((o) => o.id)));
  const sound = useSound();
  const { enabled: soundOn, play } = sound;
  useWakeLock();

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/kitchen", { cache: "no-store" });
      if (res.status === 401) return location.reload(); // device was unpaired/revoked
      if (!res.ok) throw new Error();
      const next: KitchenOrder[] = await res.json();
      const fresh = next.filter((o) => !seen.current.has(o.id) && o.status === "received");
      next.forEach((o) => seen.current.add(o.id));
      if (fresh.length) setUnacked((u) => [...u, ...fresh.map((o) => o.number)]);
      if (fresh.length && autoPrintRef.current) setPrintQ((q) => [...q, ...fresh]);
      setOrders(next);
      setFetchOk(true);
    } catch {
      setFetchOk(false);
    }
  }, []);
  const live = useBranchLive(branch.id, refresh);

  // clock for elapsed times
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 20_000);
    return () => clearInterval(id);
  }, []);

  // auto-print is a per-tablet setting, remembered on the device
  useEffect(() => {
    const on = store.get("bk_autoprint", false);
    autoPrintRef.current = on;
    setAutoPrint(on); // eslint-disable-line react-hooks/set-state-in-effect
  }, []);
  function toggleAutoPrint() {
    const on = !autoPrint;
    autoPrintRef.current = on;
    setAutoPrint(on);
    store.set("bk_autoprint", on);
  }

  // print the first queued receipt; the next one prints after the dialog closes
  const printing = printQ[0] ?? null;
  useEffect(() => {
    if (!printing) return;
    const done = () => setPrintQ((q) => q.slice(1));
    window.addEventListener("afterprint", done, { once: true });
    const id = requestAnimationFrame(() => window.print());
    return () => { cancelAnimationFrame(id); window.removeEventListener("afterprint", done); };
  }, [printing]);
  const printOne = (o: KitchenOrder) => setPrintQ((q) => (q.some((x) => x.id === o.id) ? q : [...q, o]));

  // new-order sound repeats until someone taps the yellow bar
  useEffect(() => {
    if (!unacked.length || !soundOn) return;
    const ring = () => play([880, 1175, 880]);
    ring();
    const id = setInterval(ring, 3000);
    return () => clearInterval(id);
  }, [unacked.length, soundOn, play]);

  async function act(orderId: string, action: Action, extra?: { riderId: string }) {
    setBusy(orderId);
    const res = await fetch("/api/kitchen", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderId, action, ...extra }) }).catch(() => null);
    if (res?.status === 409) setNotice(t.stale);
    else if (!res?.ok) setFetchOk(false);
    await refresh();
    setBusy(null);
  }

  async function openMenu() {
    const res = await fetch("/api/kitchen/menu", { cache: "no-store" }).catch(() => null);
    if (res?.ok) setMenu(await res.json());
  }
  async function toggle(row: MenuRow) {
    setMenu((m) => m?.map((r) => (r.id === row.id ? { ...r, sold_out: !r.sold_out } : r)) ?? null);
    const res = await fetch("/api/kitchen/menu", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ itemId: row.id, soldOut: !row.sold_out }) }).catch(() => null);
    if (!res?.ok) openMenu(); // revert to server truth
  }

  async function unpair() {
    if (!confirm(dict[lang].pair.confirmUnpair)) return;
    await fetch("/api/devices?kind=kitchen", { method: "DELETE" });
    location.reload();
  }

  const col = (status: string, title: string) => {
    // problem deliveries (rider flagged no answer / wrong address / refused) come back to the Ready column
    const xs = orders.filter((o) => o.status === status || (status === "ready" && o.status === "out_for_delivery"));
    return (
      <section className="col" aria-label={title}>
        <h2><span>{title}</span><b className="num">{xs.length}</b></h2>
        {xs.length ? xs.map(ticket) : <p className="empty">{t.none}</p>}
      </section>
    );
  };

  function ticket(o: KitchenOrder) {
    const age = minsSince(o.created_at, now);
    const cls = o.status === "ready" ? "" : age >= 12 ? "late" : age >= 8 ? "warn" : "";
    const noShow = o.status === "ready" && o.type === "pickup" && o.ready_at && minsSince(o.ready_at, now) >= NO_SHOW_MIN;
    const next: [Action, string, string] | null =
      o.status === "received" ? ["start", t.start, ""]
      : o.status === "preparing" ? ["ready", t.markReady, "ok"]
      : o.status === "ready" && o.type === "pickup" ? ["collected", t.collected, ""]
      : null; // delivery: rider picks it up from the rider page
    return (
      <article key={o.id} className={`tk ${cls}`}>
        <div className="top">
          <span className="no num">#{o.number}</span>
          <span className="flex items-center gap-2">
            <span className="el num">{fmtAge(age, lang)}</span>
            <button type="button" className="kprint" onClick={() => printOne(o)} aria-label={`${t.print} #${o.number}`}>🖨</button>
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <b className="text-lg">{o.first_name}</b>
          <span className={`ktag ${o.type === "delivery" ? "dark" : ""}`}>{o.type === "pickup" ? t.pickup : t.delivery}</span>
          {o.pickup_in_min > 0 && <span className="ktag">{t.inMin(o.pickup_in_min)}</span>}
          {o.call_phone && <a href={`tel:${o.call_phone}`} className="ktag dark call" dir="ltr">📞 {t.callConfirm} {o.call_phone}</a>}
        </div>
        <ul>
          {o.items.map((l, i) => (
            <li key={i}><b className="num">{l.qty}×</b> {pick(l, lang)}{l.option_ar && <small> ({lang === "ar" ? l.option_ar : l.option_en})</small>}</li>
          ))}
        </ul>
        <div className="meta">
          <span>{o.payment_status === "paid" ? t.paid : t.collectCash(o.total)}</span>
        </div>
        {o.problem && <span className="ktag dark bg-bad! text-base!">⚠ {t.problem[o.problem as Problem] ?? o.problem}</span>}
        {o.type === "delivery" && o.status === "ready" && (
          <label className="grid gap-1 text-sm font-semibold">
            {t.rider}
            <select className="kselect" value={o.rider_id ?? ""} disabled={busy === o.id} onChange={(e) => act(o.id, "assign", { riderId: e.target.value })}>
              <option value="" disabled>{t.assignRider}</option>
              {riders.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
            {o.rider_id && <span className="text-muted">{t.waitingPickup}</span>}
          </label>
        )}
        {o.status === "out_for_delivery" && o.problem && (
          <button type="button" className="go quiet" disabled={busy === o.id} onClick={() => act(o.id, "returned")}>{t.returned}</button>
        )}
        {next && (
          <button type="button" className={`go ${next[2]}`} disabled={busy === o.id} onClick={() => act(o.id, next[0])}>{next[1]}</button>
        )}
        {noShow && <button type="button" className="go quiet" disabled={busy === o.id} onClick={() => act(o.id, "not_collected")}>{t.notCollected}</button>}
      </article>
    );
  }

  const openOrders = orders.filter((o) => o.status === "received" || o.status === "preparing");
  const oldest = openOrders.reduce((m, o) => Math.max(m, minsSince(o.created_at, now)), 0);
  const lateCount = openOrders.filter((o) => minsSince(o.created_at, now) >= 12).length;

  return (
    <main className="night">
      {!sound.enabled && (
        <div className="sound-gate"><button type="button" onClick={sound.enable}>🔔 {t.enableSound}</button></div>
      )}
      <header className="staff-bar">
        <h1>{t.title} · {pick(branch, lang)}</h1>
        <div className="kstats num" aria-live="polite">
          <span>{t.openOrders(openOrders.length)}</span>
          {openOrders.length > 0 && <span>{t.oldestAge(fmtAge(oldest, lang))}</span>}
          {lateCount > 0 && <span className="bad">{t.late(lateCount)}</span>}
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={`tbtn ${autoPrint ? "on" : ""}`} aria-pressed={autoPrint} onClick={toggleAutoPrint}>🖨 {t.autoPrint}</button>
          <button type="button" className="tbtn hot" onClick={openMenu}>{t.soldOut}</button>
          <LangToggle lang={lang} />
          <button type="button" className="tbtn" onClick={unpair}>{dict[lang].pair.unpair}</button>
        </div>
      </header>
      {(!live || !fetchOk) && <p className="offline" role="alert">{t.offline}</p>}
      {unacked.length > 0 && (
        <button type="button" className="new-alert" onClick={() => setUnacked([])}>
          {t.newAlert(unacked.length)} <span className="num">#{unacked.join(" #")}</span>
        </button>
      )}
      {notice && <button type="button" className="offline w-full bg-warn!" onClick={() => setNotice(null)}>{notice}</button>}

      <div className="cols">
        {col("received", t.new)}
        {col("preparing", t.preparing)}
        {col("ready", t.ready)}
      </div>

      {printing && <Receipt o={printing} lang={lang} branch={pick(branch, lang)} />}

      {menu && (
        <div className="sheet-bg" onClick={(e) => e.target === e.currentTarget && setMenu(null)}>
          <div className="sheet" role="dialog" aria-modal="true" aria-label={t.soldOut}>
            <h3>{t.soldOut}</h3>
            {menu.map((r) => (
              <div key={r.id} className="line">
                <b>{pick(r, lang)}</b>
                <button type="button" className="stock" aria-pressed={r.sold_out} onClick={() => toggle(r)}>
                  {r.sold_out ? t.out : t.available}
                </button>
              </div>
            ))}
            <button type="button" className="btn alt mt-3" onClick={() => setMenu(null)}>{dict[lang].back}</button>
          </div>
        </div>
      )}
    </main>
  );
}

// 80 mm thermal receipt. Shown only when printing (see .receipt in globals.css).
function Receipt({ o, lang, branch }: { o: KitchenOrder; lang: Lang; branch: string }) {
  const t = dict[lang].kitchen;
  const d = dict[lang];
  const at = new Date(o.created_at).toLocaleString(lang === "ar" ? "ar-EG" : "en-GB", {
    timeZone: "Africa/Cairo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
  });
  return (
    <section className="receipt" aria-hidden="true">
      <div className="r-brand">{d.brand}</div>
      <div className="r-center">{branch}</div>
      <div className="r-no num">#{o.number}</div>
      <div className="r-center r-strong">{o.type === "pickup" ? t.receiptPickup : t.receiptDelivery}{o.pickup_in_min > 0 && ` · ${t.inMin(o.pickup_in_min)}`}</div>
      <div className="r-row"><span>{o.first_name}</span><span className="num">{at}</span></div>
      <hr />
      <div className="r-strong">{t.receiptItems}</div>
      {o.items.map((l, i) => (
        <div key={i} className="r-item">
          <span className="num r-qty">{l.qty}×</span>
          <span>{pick(l, lang)}{l.option_ar && <><br /><small>— {lang === "ar" ? l.option_ar : l.option_en}</small></>}</span>
        </div>
      ))}
      <hr />
      <div className="r-row r-total"><span>{t.receiptTotal}</span><span className="num">{o.total} {d.egp}</span></div>
      <div className="r-center r-strong">{o.payment_status === "paid" ? t.receiptPaid : t.receiptCash}</div>
      <hr />
      <div className="r-center"><small>{t.receiptThanks}</small></div>
    </section>
  );
}
