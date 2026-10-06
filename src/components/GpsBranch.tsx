"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { store } from "@/lib/client";
import { nearestBranch } from "@/lib/geo";
import { dict, type Lang } from "@/lib/i18n";

type B = { slug: string; lat: number | null; lng: number | null; maxKm: number };

// "Use my location": nearest branch that delivers that far. The pin is kept on the device
// (not in the URL) and pre-fills the delivery address for the rider.
export function GpsBranch({ lang, branches }: { lang: Lang; branches: B[] }) {
  const t = dict[lang].delivery;
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  function locate() {
    setMsg(null);
    if (!navigator.geolocation || !window.isSecureContext) return setMsg(t.gpsFail);
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        const pin: [number, number] = [+p.coords.latitude.toFixed(6), +p.coords.longitude.toFixed(6)];
        const hit = nearestBranch(pin, branches);
        setBusy(false);
        if (!hit) return setMsg(t.gpsNoZone);
        store.set("bk_pin", pin);
        router.push(`/b/${hit.b.slug}?mode=delivery`);
      },
      () => { setBusy(false); setMsg(t.gpsFail); },
      { enableHighAccuracy: true, timeout: 15_000 },
    );
  }
  return (
    <div>
      <button type="button" className="btn yellow" onClick={locate} disabled={busy}>{busy ? dict[lang].loading : t.useGps}</button>
      {msg && <p className="alert">{msg}</p>}
    </div>
  );
}
