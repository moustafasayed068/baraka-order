"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { DeviceBranch } from "@/lib/db";
import { dict, pick, type Lang } from "@/lib/i18n";
import { useBranchLive, useSound, useWakeLock } from "@/lib/staff-client";

type Nums = { preparing: number[]; ready: number[] };

// TV above the pickup window: numbers only, no names. Pickup orders only.
export function Tv({ lang, branch, qr, initial }: { lang: Lang; branch: DeviceBranch; qr: string; initial: Nums }) {
  const t = dict[lang];
  const other = dict[lang === "ar" ? "en" : "ar"].screen; // bilingual headings for a mixed crowd
  const [nums, setNums] = useState(initial);
  const [fresh, setFresh] = useState<number[]>([]);
  const [fetchOk, setFetchOk] = useState(true);
  const [clock, setClock] = useState("");
  const lastReady = useRef(new Set(initial.ready));
  const { enabled: soundOn, enable, play } = useSound();
  useWakeLock();

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/screen", { cache: "no-store" });
      if (res.status === 401) return location.reload();
      if (!res.ok) throw new Error();
      const next: Nums = await res.json();
      const newly = next.ready.filter((n) => !lastReady.current.has(n));
      lastReady.current = new Set(next.ready);
      if (newly.length) {
        setFresh(newly);
        play([1046, 1318, 1568]); // chime
      }
      setNums(next);
      setFetchOk(true);
    } catch {
      setFetchOk(false);
    }
  }, [play]);
  const live = useBranchLive(branch.id, refresh);

  useEffect(() => {
    const tick = () => setClock(new Date().toLocaleTimeString(lang === "ar" ? "ar-EG" : "en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Cairo" }));
    tick();
    const id = setInterval(tick, 10_000);
    return () => clearInterval(id);
  }, [lang]);

  return (
    <main className="tv">
      {!soundOn && <div className="sound-gate"><button type="button" onClick={enable}>🔔 {t.kitchen.enableSound}</button></div>}
      <header className="tv-head">
        <div className="wordmark">{t.brand}<span>{t.brandSub} · {pick(branch, lang)}</span></div>
        <div className="clock num">{clock}</div>
      </header>
      {(!live || !fetchOk) && <p className="offline" role="alert">{t.kitchen.offline}</p>}
      <div className="tv-cols">
        <section className="tv-col">
          <h2>{t.screen.preparing}<small>{other.preparing}</small></h2>
          <div className="nums">{nums.preparing.map((n) => <span key={n} className="num">{n}</span>)}</div>
        </section>
        <section className="tv-col ready" aria-live="polite">
          <h2>{t.screen.ready}<small>{other.ready}</small></h2>
          <div className="nums">{nums.ready.map((n) => <span key={n} className={`num ${fresh.includes(n) ? "fresh" : ""}`}>{n}</span>)}</div>
        </section>
      </div>
      <footer className="tv-foot">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={qr} alt="" />
        <span className="flex-1">{t.screen.orderFromPhone}</span>
        <span>{t.screen.hotline}: <b className="num">16099</b></span>
      </footer>
    </main>
  );
}
