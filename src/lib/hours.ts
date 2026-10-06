// Opening hours in Africa/Cairo. Hours may cross midnight (09:00–04:00).

function cairoMinutes(now: Date): number {
  const [h, m] = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Cairo", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .format(now)
    .split(":")
    .map(Number);
  return h * 60 + m;
}

const toMinutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

export function isOpenAt(opensAt: string, closesAt: string, now = new Date()): boolean {
  const m = cairoMinutes(now), o = toMinutes(opensAt), c = toMinutes(closesAt);
  if (o === c) return true; // 24h
  return o < c ? m >= o && m < c : m >= o || m < c;
}

// "09:00:00" -> "9:00 AM"
export const fmtTime = (t: string, lang: "ar" | "en") =>
  new Date(`2000-01-01T${t.slice(0, 5)}:00`).toLocaleTimeString(lang === "ar" ? "ar-EG" : "en-US", { hour: "numeric", minute: "2-digit" });
