import Link from "next/link";
import { redirect } from "next/navigation";
import { getStaff, needs2fa, staffDb } from "@/lib/auth";
import { getLang } from "@/lib/db";
import { businessDate } from "@/lib/hours";
import { dict, pick } from "@/lib/i18n";

type Dash = {
  orders: number; revenue: number; open: number; cancelled: number; not_collected: number; pickup: number; delivery: number;
  avg_prep_min: number | null; avg_delivery_min: number | null;
  best: { name_ar: string; name_en: string; qty: number }[];
  by_hour: Record<string, number>;
  by_branch: { name_ar: string; name_en: string; orders: number; revenue: number }[];
};

const daysAgo = (d: string, n: number) => new Date(Date.parse(d) - n * 86400_000).toISOString().slice(0, 10);
// Opening hours 09:00 → 04:00, so hours are listed in that order
const HOURS = [...Array.from({ length: 15 }, (_, i) => i + 9), 0, 1, 2, 3];

// Owner / manager overview. The dashboard() SQL function runs with the caller's RLS (manager = own branch).
export default async function Dashboard({ searchParams }: PageProps<"/admin">) {
  // Pages render in parallel with the layout, so each page checks the session itself.
  const staff = await getStaff();
  if (!staff) redirect("/admin/login");
  if (needs2fa(staff)) redirect("/admin/mfa");
  if (staff.role === "cashier") redirect("/admin/orders");
  if (staff.role === "callcentre") redirect("/admin/call");
  if (staff.role === "kitchen") redirect("/kitchen");
  const sp = await searchParams;
  const lang = await getLang();
  const t = dict[lang].admin.db;
  const egp = dict[lang].egp;
  const db = await staffDb();
  const week = sp.range === "week";
  const to = businessDate();
  const from = week ? daysAgo(to, 6) : to;
  const owner = staff.role === "owner";
  const branchId = owner ? (typeof sp.branch === "string" && sp.branch ? sp.branch : null) : staff.branchId;
  const [{ data: branches }, { data, error }] = await Promise.all([
    owner ? db.from("branches").select("id, name_ar, name_en").order("sort") : Promise.resolve({ data: [] }),
    db.rpc("dashboard", { p_branch: branchId, p_from: from, p_to: to }),
  ]);
  if (error) throw error;
  const d = data as Dash;
  const maxBest = Math.max(1, ...d.best.map((b) => b.qty));
  const done = Math.max(0, d.orders - d.cancelled - d.open - d.not_collected);
  const avgOrder = done > 0 ? Math.round(d.revenue / done) : null;
  const share = d.orders ? Math.round((d.delivery / d.orders) * 100) : 0;
  const maxHour = Math.max(1, ...Object.values(d.by_hour));
  const href = (range: string, branch = branchId ?? "") => `/admin?range=${range}${owner && branch ? `&branch=${branch}` : ""}`;

  return (
    <>
      <nav className="flex flex-wrap items-center gap-2" aria-label="filters">
        <Link href={href("today")} className="chip grid place-items-center" aria-current={!week}>{t.today}</Link>
        <Link href={href("week")} className="chip grid place-items-center" aria-current={week}>{t.week}</Link>
        {owner && (
          <form className="flex items-center gap-2">
            <input type="hidden" name="range" value={week ? "week" : "today"} />
            <select name="branch" defaultValue={branchId ?? ""} className="select w-auto!" aria-label={t.branch}>
              <option value="">{dict[lang].admin.allBranches}</option>
              {branches!.map((b) => <option key={b.id} value={b.id}>{pick(b, lang)}</option>)}
            </select>
            <button type="submit" className="chip">✓</button>
          </form>
        )}
      </nav>

      <div className="kpis">
        <div className="kpi k-red"><span>📦 {t.orders}</span><b className="num">{d.orders}</b><small>{t.split(d.pickup, d.delivery)}</small></div>
        <div className="kpi k-yellow"><span>💰 {t.revenue}</span><b className="num">{d.revenue.toLocaleString("en")} <small>{egp}</small></b><small className="num">{d.open} {t.open}</small></div>
        <div className="kpi k-ink"><span>⏱ {t.avgPrep}</span><b className="num">{d.avg_prep_min ?? "—"} <small>{t.min}</small></b><small className="num">{d.cancelled} {t.cancelled} · {d.not_collected} {t.notCollected}</small></div>
        <div className="kpi k-ok"><span>🧾 {t.avgOrder}</span><b className="num">{avgOrder ?? "—"} {avgOrder !== null && <small>{egp}</small>}</b><small className="num">{t.share}: {share}%</small></div>
        <div className="kpi k-ink"><span>🛵 {t.avgDelivery}</span><b className="num">{d.avg_delivery_min ?? "—"} <small>{t.min}</small></b><small className="num">{d.delivery} {t.deliveries}</small></div>
      </div>

      {d.orders === 0 ? <p className="card text-muted">{t.noData}</p> : (
        <div className="grid gap-4 md:grid-cols-2">
          <section className="card">
            <h2>{t.best}</h2>
            <ol className="hbars">
              {d.best.map((b) => (
                <li key={b.name_en} title={`${pick(b, lang)}: ${b.qty}`}>
                  <span className="lbl">{pick(b, lang)}</span>
                  <span className="bar-track"><i style={{ inlineSize: `${(b.qty / maxBest) * 100}%` }} /></span>
                  <b className="num">{b.qty}</b>
                </li>
              ))}
            </ol>
          </section>

          <section className="card">
            <h2>{t.byHour}</h2>
            <div className="vbars" role="img" aria-label={t.byHour}>
              {HOURS.map((h) => {
                const n = d.by_hour[h] ?? 0;
                return (
                  <div key={h} className="vcol" title={`${String(h).padStart(2, "0")}:00 — ${n}`} tabIndex={0}>
                    <i style={{ blockSize: `${(n / maxHour) * 100}%` }} />
                    <span className="num">{h}</span>
                  </div>
                );
              })}
            </div>
            <details>
              <summary className="cursor-pointer text-sm">{t.table}</summary>
              <table className="tbl"><thead><tr><th>{t.hour}</th><th>{t.count}</th></tr></thead>
                <tbody>{HOURS.filter((h) => d.by_hour[h]).map((h) => <tr key={h}><td className="num">{String(h).padStart(2, "0")}:00</td><td className="num">{d.by_hour[h]}</td></tr>)}</tbody>
              </table>
            </details>
          </section>
        </div>
      )}

      {owner && !branchId && d.by_branch.length > 0 && (
        <section className="card">
          <h2>{t.byBranch}</h2>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>{t.branch}</th><th>{t.orders}</th><th>{t.revenue}</th></tr></thead>
              <tbody>{d.by_branch.map((b) => <tr key={b.name_en}><td>{pick(b, lang)}</td><td className="num">{b.orders}</td><td className="num">{b.revenue.toLocaleString("en")} {egp}</td></tr>)}</tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
