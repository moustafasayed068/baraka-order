"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { matchZone, type Pt } from "@/lib/geo";
import { dict, type Lang } from "@/lib/i18n";

// "Use my location": finds the zone (and so the branch) whose polygon covers the customer.
export function GpsZone({ lang, zones }: { lang: Lang; zones: { id: string; polygon: Pt[] | null; href: string }[] }) {
  const t = dict[lang].delivery;
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  function locate() {
    setMsg(null);
    if (!navigator.geolocation) return setMsg(t.gpsFail);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        const z = matchZone([p.coords.latitude, p.coords.longitude], zones);
        if (z) router.push(z.href);
        else setMsg(t.gpsNoZone);
      },
      () => setMsg(t.gpsFail),
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }
  return (
    <div>
      <button type="button" className="btn yellow" onClick={locate}>{t.useGps}</button>
      {msg && <p className="alert">{msg}</p>}
    </div>
  );
}
