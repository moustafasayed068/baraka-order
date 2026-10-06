import { rolesFor } from "@/lib/admin-nav";
import { requireStaff, staffDb } from "@/lib/auth";
import { getLang } from "@/lib/db";
import { businessDate } from "@/lib/hours";
import { dict, pick, type OrderStatus } from "@/lib/i18n";
import { maskPhone, normalizePhone } from "@/lib/phone";
import { cancelOrder, setBlocked } from "./actions";

const STATUSES = ["received", "preparing", "ready", "out_for_delivery", "collected", "delivered", "not_collected", "cancelled"] as const;
const OPEN = ["received", "preparing", "ready", "out_for_delivery"];

type Row = {
  id: string; number: number; business_date: string; created_at: string; type: string; status: string; source: string; total: number;
  customer_name: string; customer_phone: string; problem: string | null; needs_call_confirm: boolean;
  address: { street: string; building: string; floor: string; apartment: string; landmark: string } | null;
  branches: { name_ar: string; name_en: string }; riders: { name: string } | null;
  customers: { id: string; blocked: boolean } | null;
  order_items: { qty: number; name_ar: string; name_en: string; option_ar: string | null; option_en: string | null }[];
};

export default async function OrdersPage({ searchParams }: PageProps<"/admin/orders">) {
  const staff = await requireStaff(rolesFor("orders"));
  const sp = await searchParams;
  const lang = await getLang();
  const a = dict[lang].admin;
  const t = a.or;
  const st = t.st;
  const canManage = staff.role === "owner" || staff.role === "manager"; // full phone, address, cancel, block
  const q = typeof sp.q === "string" ? normalizePhone(sp.q.trim()) : "";
  const date = typeof sp.date === "string" ? sp.date : businessDate();
  const status = typeof sp.status === "string" && (STATUSES as readonly string[]).includes(sp.status) ? sp.status : "";

  let query = (await staffDb()).from("orders")
    .select("id, number, business_date, created_at, type, status, source, total, customer_name, customer_phone, problem, needs_call_confirm, address, branches(name_ar, name_en), riders(name), customers(id, blocked), order_items(qty, name_ar, name_en, option_ar, option_en)")
    .order("created_at", { ascending: false })
    .limit(200);
  if (/^\d{1,4}$/.test(q)) query = query.eq("number", Number(q)); // order number
  else if (q) query = query.like("customer_phone", `%${q.replace(/[%_]/g, "")}%`); // phone (or part of it)
  if (date) query = query.eq("business_date", date); // RLS already limits managers/cashiers to their branch
  if (status) query = query.eq("status", status);
  const { data, error } = await query;
  if (error) throw error;
  const rows = data as unknown as Row[];
  const fmt = (iso: string) => new Date(iso).toLocaleTimeString(lang === "ar" ? "ar-EG" : "en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Cairo" });

  return (
    <>
      <form className="card grid-form" role="search">
        <div className="field"><label htmlFor="q">{t.search}</label><input id="q" name="q" defaultValue={q} dir="ltr" inputMode="numeric" /></div>
        <div className="field"><label htmlFor="date">{t.date}</label><input id="date" name="date" type="date" defaultValue={date} /></div>
        <div className="field">
          <label htmlFor="status">{t.status}</label>
          <select id="status" name="status" className="select" defaultValue={status}>
            <option value="">{t.all}</option>
            {STATUSES.map((s) => <option key={s} value={s}>{st[s]}</option>)}
          </select>
        </div>
        <button type="submit" className="btn w-auto! px-6!">{t.find}</button>
      </form>

      <p className="text-muted">
        {t.showing(rows.length)} · {t.cashTotal}: <b className="num">{rows.filter((r) => r.status !== "cancelled").reduce((s, r) => s + r.total, 0)} {dict[lang].egp}</b>
      </p>
      {rows.length === 0 && <p className="card text-muted">{t.none}</p>}

      {rows.map((o) => (
        <details key={o.id} className={`card ${o.status === "cancelled" ? "opacity-60" : ""}`}>
          <summary className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1">
            <b className="display text-2xl text-red num">#{o.number}</b>
            <span className="num">{fmt(o.created_at)}</span>
            {staff.role === "owner" && <span className="ktag">{pick(o.branches, lang)}</span>}
            <span className={`ktag ${o.type === "delivery" ? "dark" : ""}`}>{o.type === "delivery" ? dict[lang].kitchen.delivery : dict[lang].kitchen.pickup}</span>
            {o.source === "callcentre" && <span className="ktag">📞 {t.source.callcentre}</span>}
            <span>{o.customer_name} · <span dir="ltr" className="num">{canManage ? o.customer_phone : maskPhone(o.customer_phone)}</span></span>
            <b>{st[o.status as OrderStatus]}</b>
            {o.problem && <span className="ktag dark bg-bad!">⚠ {o.problem}</span>}
            {o.customers?.blocked && <span className="ktag dark">{t.blocked}</span>}
            <b className="ms-auto num">{o.total} {dict[lang].egp}</b>
          </summary>

          <ul className="m-0 list-disc ps-5">
            {o.order_items.map((l, i) => <li key={i}><span className="num">{l.qty}×</span> {pick(l, lang)}{l.option_ar && ` (${lang === "ar" ? l.option_ar : l.option_en})`}</li>)}
          </ul>
          {canManage && o.address && (
            <p><b>{t.address}:</b> {[o.address.street, o.address.building, o.address.floor, o.address.apartment].filter(Boolean).join(" · ")}{o.address.landmark && ` — ${o.address.landmark}`}</p>
          )}
          {o.riders && <p><b>{t.rider}:</b> {o.riders.name}</p>}

          {canManage && (
            <div className="flex flex-wrap items-end gap-3">
              {OPEN.includes(o.status) && (
                <form action={cancelOrder} className="flex flex-wrap items-end gap-2">
                  <input type="hidden" name="id" value={o.id} />
                  <div className="field m-0!"><label htmlFor={`r-${o.id}`}>{t.cancelReason}</label><input id={`r-${o.id}`} name="reason" maxLength={200} /></div>
                  <button type="submit" className="chip border-red! text-red!">{t.cancel}</button>
                </form>
              )}
              {o.customers && (
                <form action={setBlocked}>
                  <input type="hidden" name="id" value={o.customers.id} />
                  <input type="hidden" name="blocked" value={String(!o.customers.blocked)} />
                  <button type="submit" className="chip" title={t.blockNote}>{o.customers.blocked ? t.unblock : `🚫 ${t.block}`}</button>
                </form>
              )}
            </div>
          )}
        </details>
      ))}
    </>
  );
}
