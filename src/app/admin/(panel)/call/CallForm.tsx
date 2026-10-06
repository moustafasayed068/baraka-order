"use client";
import { useState, useTransition } from "react";
import { uuid } from "@/lib/client";
import { dict, pick, type Lang } from "@/lib/i18n";
import { normalizePhone, PHONE_RE } from "@/lib/phone";
import { placePhoneOrder, type PhoneOrderResult } from "./actions";

export type CallItem = {
  id: string; category_id: string; name_ar: string; name_en: string; base_price: number;
  options: { id: string; name_ar: string; name_en: string; price_delta: number; sort: number }[];
};
type Named = { id: string; name_ar: string; name_en: string };
type Line = { qty: number; optionId: string | null };
const EMPTY_ADDR = { street: "", building: "", floor: "", apartment: "", landmark: "" };

// Hotline order entry. Prices shown here are a preview; the server recalculates everything.
export function CallForm({ lang, branches, categories, items }: {
  lang: Lang; branches: (Named & { slug: string })[]; categories: Named[]; items: CallItem[];
}) {
  const t = dict[lang];
  const c = t.admin.cc;
  const [branch, setBranch] = useState(branches[0]?.slug ?? "");
  const [type, setType] = useState<"pickup" | "delivery">("pickup");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [addr, setAddr] = useState(EMPTY_ADDR);
  const [lines, setLines] = useState<Record<string, Line>>({});
  const [key, setKey] = useState(() => uuid()); // one idempotency key per order: double clicks never duplicate
  const [result, setResult] = useState<PhoneOrderResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();

  const line = (i: CallItem) => lines[i.id] ?? { qty: 0, optionId: i.options[0]?.id ?? null };
  const setLine = (i: CallItem, patch: Partial<Line>) => setLines((l) => ({ ...l, [i.id]: { ...line(i), ...patch } }));
  const chosen = items.filter((i) => line(i).qty > 0);
  const unit = (i: CallItem) => i.base_price + (i.options.find((o) => o.id === line(i).optionId)?.price_delta ?? 0);
  const subtotal = chosen.reduce((s, i) => s + unit(i) * line(i).qty, 0);
  const tel = normalizePhone(phone);
  const ready = !!branch && name.trim().length >= 2 && PHONE_RE.test(tel) && chosen.length > 0 && (type === "pickup" || addr.street.trim().length >= 3);

  function send() {
    setResult(null);
    start(async () => {
      const r = await placePhoneOrder({
        branch, idempotencyKey: key, type, name: name.trim(), phone: tel, pickupInMin: 0,
        lines: chosen.map((i) => ({ itemId: i.id, optionId: line(i).optionId, qty: line(i).qty })),
        ...(type === "delivery" ? { address: { ...addr, lat: null, lng: null } } : {}),
      });
      setResult(r);
    });
  }
  function reset() {
    setName(""); setPhone(""); setAddr(EMPTY_ADDR); setLines({}); setResult(null); setCopied(false); setKey(uuid());
  }

  if (result?.ok) {
    return (
      <section className="card">
        <h2>✓ {c.sent(result.number)}</h2>
        <p className="text-sm text-muted">{c.trackLink}</p>
        <div className="flex flex-wrap items-center gap-2">
          <code dir="ltr" className="break-all rounded-lg bg-paper px-2 py-1">{result.link}</code>
          <button type="button" className="chip" onClick={() => navigator.clipboard?.writeText(result.link).then(() => setCopied(true))}>{copied ? c.copied : c.copy}</button>
        </div>
        <button type="button" className="btn w-auto! px-6!" onClick={reset}>{c.newOrder}</button>
      </section>
    );
  }

  const field = (id: string, label: string, el: React.ReactNode) => <div key={id} className="field"><label htmlFor={id}>{label}</label>{el}</div>;

  return (
    <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); if (ready && !pending) send(); }}>
      <section className="card">
        <h2>{c.title}</h2>
        <div className="grid-form">
          {field("cc-branch", c.branch, (
            <select id="cc-branch" className="select" value={branch} onChange={(e) => setBranch(e.target.value)}>
              {branches.map((b) => <option key={b.slug} value={b.slug}>{pick(b, lang)}</option>)}
            </select>
          ))}
          <div className="seg self-end" role="group">
            <button type="button" aria-pressed={type === "pickup"} onClick={() => setType("pickup")}>{t.delivery.pickup}</button>
            <button type="button" aria-pressed={type === "delivery"} onClick={() => setType("delivery")}>{t.delivery.delivery}</button>
          </div>
        </div>
      </section>

      <section className="card">
        <h2>{c.customer}</h2>
        <div className="grid-form">
          {field("cc-name", t.cart.name, <input id="cc-name" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />)}
          {field("cc-phone", t.cart.phone, <input id="cc-phone" type="tel" dir="ltr" maxLength={14} value={phone} onChange={(e) => setPhone(e.target.value)} aria-invalid={!!phone && !PHONE_RE.test(tel)} />)}
          {type === "delivery" && (["street", "building", "floor", "apartment", "landmark"] as const).map((k) =>
            field(`cc-${k}`, t.delivery[k], <input id={`cc-${k}`} value={addr[k]} maxLength={k === "street" || k === "landmark" ? 120 : 40} onChange={(e) => setAddr({ ...addr, [k]: e.target.value })} />),
          )}
        </div>
      </section>

      <section className="card">
        <h2>{c.items}</h2>
        {categories.map((cat) => (
          <div key={cat.id} className="grid gap-1">
            <h3 className="font-bold text-red">{pick(cat, lang)}</h3>
            {items.filter((i) => i.category_id === cat.id).map((i) => (
              <div key={i.id} className={`flex flex-wrap items-center gap-2 rounded-lg px-2 py-1 ${line(i).qty ? "bg-paper" : ""}`}>
                <span className="min-w-40 flex-1 font-semibold">{pick(i, lang)}</span>
                {i.options.length > 0 && (
                  <select className="select w-auto!" aria-label={c.choice} value={line(i).optionId ?? ""} onChange={(e) => setLine(i, { optionId: e.target.value })}>
                    {i.options.map((o) => <option key={o.id} value={o.id}>{pick(o, lang)}{o.price_delta ? ` +${o.price_delta}` : ""}</option>)}
                  </select>
                )}
                <span className="num w-14 text-end">{unit(i)}</span>
                <div className="qty">
                  <button type="button" aria-label="-" onClick={() => setLine(i, { qty: Math.max(0, line(i).qty - 1) })}>−</button>
                  <b className="num w-6 text-center" aria-label={c.qty}>{line(i).qty}</b>
                  <button type="button" aria-label="+" onClick={() => setLine(i, { qty: Math.min(20, line(i).qty + 1) })}>+</button>
                </div>
              </div>
            ))}
          </div>
        ))}
      </section>

      <section className="card sticky bottom-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <b>{c.subtotal}: <span className="num">{subtotal} {t.egp}</span></b>
            {type === "delivery" && <p className="text-sm text-muted">{c.feeNote}</p>}
          </div>
          <button type="submit" className="btn w-auto! px-8!" disabled={!ready || pending}>{pending ? c.sending : c.send}</button>
        </div>
        {chosen.length === 0 && <p className="text-sm text-muted">{c.empty}</p>}
        {result && !result.ok && <p className="alert m-0!" role="alert">{t.errors[result.error] ?? t.admin.error}</p>}
      </section>
    </form>
  );
}
