import { ActionForm } from "@/components/ActionForm";
import { rolesFor } from "@/lib/admin-nav";
import { requireStaff, staffDb } from "@/lib/auth";
import { getLang } from "@/lib/db";
import { dict, pick } from "@/lib/i18n";
import { businessDate } from "@/lib/hours";
import { recordHandover, saveRider } from "./actions";

type R = { id: string; branch_id: string; name: string; phone: string; active: boolean; locked_until: string | null };

export default async function RidersPage({ searchParams }: PageProps<"/admin/riders">) {
  const staff = await requireStaff(rolesFor("riders"));
  const sp = await searchParams;
  const day = typeof sp.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : businessDate();
  const lang = await getLang();
  const a = dict[lang].admin;
  const t = a.rd;
  const db = await staffDb();
  const owner = staff.role === "owner";
  const [{ data: branches }, { data: riders, error }, { data: delivered }, { data: handovers }] = await Promise.all([
    db.from("branches").select("id, name_ar, name_en").order("sort"),
    db.from("riders").select("id, branch_id, name, phone, active, locked_until").order("name"), // RLS: manager sees own branch only
    db.from("orders").select("rider_id, total").eq("business_date", day).eq("status", "delivered").eq("payment_method", "cash").not("rider_id", "is", null),
    db.from("rider_handovers").select("rider_id, amount").eq("business_date", day),
  ]);
  const d = dict[lang].admin.db;
  const sum = <T extends { rider_id: string | null }>(rows: T[] | null, id: string, f: (r: T) => number) => (rows ?? []).filter((r) => r.rider_id === id).reduce((n, r) => n + f(r), 0);
  const cashRows = (riders as R[]).map((r) => ({
    r, count: (delivered ?? []).filter((o) => o.rider_id === r.id).length,
    expected: sum(delivered, r.id, (o) => o.total), handed: sum(handovers, r.id, (h) => h.amount),
    recorded: (handovers ?? []).some((h) => h.rider_id === r.id),
  })).filter((x) => x.count > 0 || x.recorded);
  if (error) throw error;
  const errors = { badPin: t.badPin, duplicatePhone: t.duplicatePhone };
  const branchName = (id: string) => pick(branches!.find((b) => b.id === id)!, lang);
  const branchField = (r?: R) =>
    owner ? (
      <div className="field">
        <label htmlFor={`b-${r?.id ?? "new"}`}>{t.branch}</label>
        <select id={`b-${r?.id ?? "new"}`} name="branch_id" className="select" defaultValue={r?.branch_id ?? branches![0].id}>
          {branches!.map((b) => <option key={b.id} value={b.id}>{pick(b, lang)}</option>)}
        </select>
      </div>
    ) : null;

  return (
    <>
      <section className="card">
        <h2>{d.cash}</h2>
        <form className="flex flex-wrap items-end gap-2">
          <div className="field m-0!"><label htmlFor="cash-day">{d.cashDay}</label><input id="cash-day" name="date" type="date" defaultValue={day} /></div>
          <button type="submit" className="chip">✓</button>
        </form>
        {cashRows.length === 0 ? <p className="text-muted">{d.noData}</p> : (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>{t.name}</th><th>{d.deliveries}</th><th>{d.expected}</th><th>{d.handed}</th><th>{d.diff}</th><th>{d.record}</th></tr></thead>
              <tbody>
                {cashRows.map(({ r, count, expected, handed, recorded }) => {
                  const diff = handed - expected;
                  return (
                    <tr key={r.id}>
                      <td>{r.name}</td>
                      <td className="num">{count}</td>
                      <td className="num">{expected} {dict[lang].egp}</td>
                      <td className="num">{recorded ? `${handed} ${dict[lang].egp}` : "—"}</td>
                      <td>{!recorded ? "—" : diff === 0 ? <span className="ok-note">✓ {d.ok}</span> : <span className="ktag dark bg-bad!">⚠ {diff < 0 ? d.short(-diff) : d.over(diff)}</span>}</td>
                      <td>
                        <ActionForm action={recordHandover} submit={d.record} saved={a.saved} failed={a.error} className="flex flex-wrap items-end gap-2">
                          <input type="hidden" name="rider_id" value={r.id} />
                          <input type="hidden" name="business_date" value={day} />
                          <input name="amount" type="number" min={0} defaultValue={Math.max(0, expected - handed)} aria-label={d.amount} className="w-24 rounded-lg border border-line px-2 py-2" />
                        </ActionForm>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <h2>{t.add}</h2>
        <ActionForm action={saveRider} submit={a.save} saved={a.saved} failed={a.error} errors={errors}>
          <div className="field"><label htmlFor="n-new">{t.name}</label><input id="n-new" name="name" required maxLength={60} /></div>
          <div className="field"><label htmlFor="p-new">{t.phone}</label><input id="p-new" name="phone" type="tel" dir="ltr" required maxLength={14} /></div>
          <div className="field"><label htmlFor="pin-new">{t.pin}</label><input id="pin-new" name="pin" type="password" inputMode="numeric" autoComplete="new-password" dir="ltr" required /></div>
          {branchField()}
        </ActionForm>
      </section>

      {(riders as R[]).length === 0 && <p className="text-muted">{t.none}</p>}
      {(riders as R[]).map((r) => (
        <section key={r.id} className={`card ${r.active ? "" : "opacity-60"}`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <b className="text-lg">{r.name}</b>
            <span className="flex gap-2">
              {owner && <span className="ktag">{branchName(r.branch_id)}</span>}
              <span className={`ktag ${r.active ? "" : "dark"}`}>{r.active ? t.active : t.inactive}</span>
              {r.locked_until && new Date(r.locked_until) > new Date() && <span className="ktag dark">🔒</span>}
            </span>
          </div>
          <ActionForm action={saveRider} submit={a.save} saved={a.saved} failed={a.error} errors={errors}>
            <input type="hidden" name="id" value={r.id} />
            <div className="field"><label htmlFor={`n-${r.id}`}>{t.name}</label><input id={`n-${r.id}`} name="name" defaultValue={r.name} required maxLength={60} /></div>
            <div className="field"><label htmlFor={`p-${r.id}`}>{t.phone}</label><input id={`p-${r.id}`} name="phone" type="tel" dir="ltr" defaultValue={r.phone} required /></div>
            <div className="field"><label htmlFor={`pin-${r.id}`}>{t.pin}</label><input id={`pin-${r.id}`} name="pin" type="password" inputMode="numeric" autoComplete="new-password" dir="ltr" placeholder={t.pinKeep} /></div>
            {branchField(r)}
            <label className="flex min-h-11 items-center gap-2"><input type="checkbox" name="active" defaultChecked={r.active} className="size-5" />{t.active}</label>
          </ActionForm>
        </section>
      ))}
    </>
  );
}
