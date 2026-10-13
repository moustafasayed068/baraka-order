import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AppHead } from "@/components/AppHead";
import { adminDb, getLang } from "@/lib/db";
import { dict, pick } from "@/lib/i18n";
import { paymentsEnabled } from "@/lib/paymob";
import { PayForm } from "./PayForm";

const EXPIRE_MIN = 15;
const minutesLeft = (createdAt: string) => Math.max(1, EXPIRE_MIN - Math.floor((Date.now() - Date.parse(createdAt)) / 60_000));

// Online payment step for an order in awaiting_payment. Only the tracking token opens it.
export default async function PayPage({ params }: PageProps<"/pay/[token]">) {
  const { token } = await params;
  if (!/^[0-9a-f]{32}$/.test(token)) notFound();
  const lang = await getLang();
  const t = dict[lang];
  const db = adminDb();
  await db.rpc("expire_unpaid_orders");
  const { data: o } = await db.from("orders")
    .select("number, total, subtotal, delivery_fee, status, created_at, branches(slug, name_ar, name_en), order_items(name_ar, name_en, option_ar, option_en, qty, line_total)")
    .eq("tracking_token", token).maybeSingle();
  if (!o) notFound();
  if (o.status !== "awaiting_payment" && o.status !== "cancelled") redirect(`/t/${token}`);
  const branch = o.branches as unknown as { slug: string; name_ar: string; name_en: string };
  const minsLeft = minutesLeft(o.created_at);

  return (
    <div className="shell">
      <AppHead lang={lang} excludeOrder={token} />
      <main className="track">
        <div className="ticket">
          <div className="text-sm opacity-90">{t.track.orderNo}</div>
          <div className="big num">{o.number}</div>
          <div className="font-semibold">{pick(branch, lang)}</div>
        </div>

        {o.status === "cancelled" ? (
          <>
            <p className="alert" role="alert">{t.pay.expired}</p>
            <Link href={`/b/${branch.slug}`} className="btn">{t.track.newOrder}</Link>
          </>
        ) : (
          <section className="pay-card">
            <h1 className="display text-3xl text-red">{t.pay.title}</h1>
            <ul className="pay-lines">
              {o.order_items.map((l, i) => (
                <li key={i}>
                  <span><span className="num">{l.qty}×</span> {pick(l, lang)}{l.option_ar && <small> · {lang === "ar" ? l.option_ar : l.option_en}</small>}</span>
                  <span className="num">{l.line_total}</span>
                </li>
              ))}
              {o.delivery_fee > 0 && <li><span>{t.delivery.fee}</span><span className="num">{o.delivery_fee}</span></li>}
            </ul>
            <div className="totals sticky-total"><span>{t.pay.total}</span><span className="num">{o.total} {t.egp}</span></div>
            <p className="pay-methods">{t.pay.methods}</p>
            <PayForm lang={lang} token={token} total={o.total} enabled={paymentsEnabled()} />
            <p className="text-sm text-muted">🔒 {t.pay.secure}</p>
            <p className="text-sm text-muted num">{t.pay.expiresIn(minsLeft)}</p>
          </section>
        )}
      </main>
    </div>
  );
}

export const metadata = { referrer: "no-referrer" };
