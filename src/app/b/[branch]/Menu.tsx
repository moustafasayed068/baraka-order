"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { elapsed, saveOrder, store, uuid } from "@/lib/client";
import { dict, pick, type ErrorCode, type Lang } from "@/lib/i18n";
import { normalizePhone, PHONE_RE } from "@/lib/phone";

type Option = { id: string; kind: "size" | "sauce"; name_ar: string; name_en: string; price_delta: number; sort: number };
export type MenuItem = {
  id: string; slug: string; category_id: string; name_ar: string; name_en: string; desc_ar: string; desc_en: string;
  base_price: number; photo_url: string | null; is_meal: boolean; sold_out: boolean; options: Option[];
};
type Category = { id: string; slug: string; name_ar: string; name_en: string };
type Line = { itemId: string; optionId: string | null; qty: number };
type Sheet = null | { kind: "cart" } | { kind: "item"; item: MenuItem; optionId: string | null; qty: number };

const MAX_QTY = 20;
const unitPrice = (i: MenuItem, optionId: string | null) => i.base_price + (i.options.find((o) => o.id === optionId)?.price_delta ?? 0);

export function Menu({ lang, branch, categories, items, blocked }: {
  lang: Lang; branch: string; categories: Category[]; items: MenuItem[]; blocked: boolean;
}) {
  const t = dict[lang];
  const router = useRouter();
  const byId = new Map(items.map((i) => [i.id, i]));
  const [cat, setCat] = useState(categories[0]?.id);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [cart, setCart] = useState<Line[]>([]);
  const [me, setMe] = useState({ name: "", phone: "" });
  const [pickupInMin, setPickupInMin] = useState<0 | 15 | 30>(0);
  const [phoneTouched, setPhoneTouched] = useState(false);
  const [bad, setBad] = useState<Set<string>>(new Set()); // items the server rejected (sold out mid-cart)
  const [error, setError] = useState<ErrorCode | null>(null);
  const [sending, setSending] = useState(false);
  const honeypot = useRef<HTMLInputElement>(null);
  const idemKey = useRef("");
  const mountedAt = useRef(0);

  // Restore cart and customer details saved on this device. Runs after hydration so server and client HTML match.
  useEffect(() => {
    mountedAt.current = Date.now();
    idemKey.current = uuid();
    /* eslint-disable react-hooks/set-state-in-effect */
    setCart(store.get<Line[]>(`bk_cart_${branch}`, []).filter((l) => byId.has(l.itemId)));
    setMe(store.get("bk_me", { name: "", phone: "" }));
    /* eslint-enable react-hooks/set-state-in-effect */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branch]);
  useEffect(() => store.set(`bk_cart_${branch}`, cart), [branch, cart]);

  const lines = cart.filter((l) => byId.has(l.itemId));
  const total = lines.reduce((s, l) => s + unitPrice(byId.get(l.itemId)!, l.optionId) * l.qty, 0);
  const count = lines.reduce((s, l) => s + l.qty, 0);
  const isOut = (id: string) => byId.get(id)?.sold_out || bad.has(id);
  const combo = items.find((i) => i.slug === "combo" && !i.sold_out);
  const showCombo = combo && lines.some((l) => byId.get(l.itemId)?.is_meal) && !lines.some((l) => l.itemId === combo.id);

  function add(itemId: string, optionId: string | null, qty = 1) {
    setCart((c) => {
      const i = c.findIndex((l) => l.itemId === itemId && l.optionId === optionId);
      if (i < 0) return [...c, { itemId, optionId, qty }];
      return c.map((l, j) => (j === i ? { ...l, qty: Math.min(MAX_QTY, l.qty + qty) } : l));
    });
  }
  const changeQty = (idx: number, d: number) =>
    setCart((c) => c.map((l, j) => (j === idx ? { ...l, qty: Math.min(MAX_QTY, l.qty + d) } : l)).filter((l) => l.qty > 0));

  const phone = normalizePhone(me.phone);
  const phoneOk = PHONE_RE.test(phone);
  const nameOk = me.name.trim().length >= 2;
  const hasBad = lines.some((l) => isOut(l.itemId));
  const canSend = !blocked && !sending && lines.length > 0 && nameOk && phoneOk && !hasBad;

  async function place() {
    if (!canSend) return;
    setSending(true);
    setError(null);
    store.set("bk_me", { name: me.name.trim(), phone });
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          branch, idempotencyKey: idemKey.current, type: "pickup", name: me.name.trim(), phone, pickupInMin,
          lines: lines.map(({ itemId, optionId, qty }) => ({ itemId, optionId, qty })),
          website: honeypot.current?.value ?? "", fillMs: elapsed(mountedAt.current),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error in t.errors ? data.error : "server");
        if (data.itemIds) setBad((b) => new Set([...b, ...data.itemIds]));
        return;
      }
      saveOrder({ token: data.token, number: data.number, branch });
      setCart([]);
      store.set(`bk_cart_${branch}`, []);
      router.push(`/t/${data.token}`);
    } catch {
      setError("network"); // same idempotency key on retry, so a lost response never doubles the order
    } finally {
      setSending(false);
    }
  }

  const shown = items.filter((i) => i.category_id === cat);
  const isExtras = categories.find((c) => c.id === cat)?.slug === "extras";

  return (
    <>
      <nav className="cats" aria-label="menu">
        {categories.map((c) => (
          <button key={c.id} type="button" aria-pressed={cat === c.id} onClick={() => setCat(c.id)}>{pick(c, lang)}</button>
        ))}
      </nav>

      <main className="menu">
        {isExtras ? (
          <div className="extras">
            {shown.map((x) => (
              <button key={x.id} type="button" className="extra" disabled={isOut(x.id)} onClick={() => add(x.id, null)}>
                <span>{pick(x, lang)}{isOut(x.id) && <> <span className="tag">{t.menu.soldOut}</span></>}</span>
                <span className="price num">{x.base_price}</span>
              </button>
            ))}
          </div>
        ) : (
          shown.map((m) => (
            <button key={m.id} type="button" className="item" disabled={isOut(m.id)}
              onClick={() => setSheet({ kind: "item", item: m, optionId: m.options[0]?.id ?? null, qty: 1 })}>
              <div className="plate">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {m.photo_url ? <img src={m.photo_url} alt="" loading="lazy" /> : m.name_ar}
              </div>
              <div>
                <h3>{pick(m, lang)} {isOut(m.id) && <span className="tag">{t.menu.soldOut}</span>}</h3>
                <p>{lang === "ar" ? m.desc_ar : m.desc_en}</p>
                <div className="pr">
                  <span className="price num">{m.options.some((o) => o.price_delta) && t.menu.from}{m.base_price}<small>{t.egp}</small></span>
                  <span className="add" aria-hidden="true">+</span>
                </div>
              </div>
            </button>
          ))
        )}
      </main>

      {count > 0 && (
        <button type="button" className="cartbar" onClick={() => setSheet({ kind: "cart" })}>
          <span><span className="count num">{count}</span>{t.menu.viewCart}</span>
          <span className="num">{total} {t.egp}</span>
        </button>
      )}

      {sheet && (
        <div className="sheet-bg" onClick={(e) => e.target === e.currentTarget && setSheet(null)}>
          {sheet.kind === "item" ? (
            <div className="sheet" role="dialog" aria-modal="true" aria-label={pick(sheet.item, lang)}>
              <h3>{pick(sheet.item, lang)}</h3>
              <div className="text-sm text-muted">{lang === "ar" ? sheet.item.desc_ar : sheet.item.desc_en}</div>
              {sheet.item.options.length > 0 && (
                <div className="opt-group">
                  <h4>{sheet.item.options[0].kind === "size" ? t.menu.size : t.menu.sauce}</h4>
                  <div className="chips">
                    {sheet.item.options.map((o) => (
                      <button key={o.id} type="button" className="chip" aria-pressed={sheet.optionId === o.id}
                        onClick={() => setSheet({ ...sheet, optionId: o.id })}>
                        {pick(o, lang)}{o.kind === "size" && <> · <span className="num">{sheet.item.base_price + o.price_delta}</span></>}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div className="opt-group qty">
                <button type="button" aria-label="-" onClick={() => setSheet({ ...sheet, qty: Math.max(1, sheet.qty - 1) })}>−</button>
                <b className="num">{sheet.qty}</b>
                <button type="button" aria-label="+" onClick={() => setSheet({ ...sheet, qty: Math.min(MAX_QTY, sheet.qty + 1) })}>+</button>
              </div>
              <div className="grid gap-2">
                <button type="button" className="btn" onClick={() => { add(sheet.item.id, sheet.optionId, sheet.qty); setSheet(null); }}>
                  {t.menu.addToCart(unitPrice(sheet.item, sheet.optionId) * sheet.qty)}
                </button>
                <button type="button" className="btn alt" onClick={() => setSheet(null)}>{t.back}</button>
              </div>
            </div>
          ) : (
            <form className="sheet" role="dialog" aria-modal="true" aria-label={t.cart.title} noValidate
              onSubmit={(e) => { e.preventDefault(); place(); }}>
              <h3>{t.cart.title}</h3>
              {lines.length === 0 && <p className="text-center text-muted py-4">{t.cart.empty}</p>}
              {lines.map((l, idx) => {
                const i = byId.get(l.itemId)!;
                const opt = i.options.find((o) => o.id === l.optionId);
                return (
                  <div key={`${l.itemId}:${l.optionId}`} className={`line ${isOut(i.id) ? "bad" : ""}`}>
                    <div className="meta">
                      <b>{pick(i, lang)}</b>
                      <small>{opt && pick(opt, lang)} {isOut(i.id) && <span className="tag">{t.menu.soldOut}</span>}</small>
                    </div>
                    <div className="qty">
                      <button type="button" aria-label="-" onClick={() => changeQty(idx, -1)}>−</button>
                      <b className="num">{l.qty}</b>
                      <button type="button" aria-label="+" onClick={() => changeQty(idx, 1)} disabled={isOut(i.id)}>+</button>
                      <span className="num min-w-14 text-end">{unitPrice(i, l.optionId) * l.qty}</span>
                    </div>
                  </div>
                );
              })}
              {showCombo && (
                <div className="upsell">
                  <span>{t.cart.combo}</span>
                  <button type="button" className="btn yellow w-auto! min-h-11!" onClick={() => add(combo.id, null)}>{t.cart.addCombo}</button>
                </div>
              )}

              <div className="field">
                <label htmlFor="f-name">{t.cart.name}</label>
                <input id="f-name" autoComplete="given-name" maxLength={40} placeholder={t.cart.namePh} value={me.name}
                  onChange={(e) => setMe({ ...me, name: e.target.value })} />
              </div>
              <div className="field">
                <label htmlFor="f-phone">{t.cart.phone}</label>
                <input id="f-phone" type="tel" inputMode="tel" autoComplete="tel" dir="ltr" maxLength={14} placeholder="01xxxxxxxxx"
                  value={me.phone} aria-invalid={phoneTouched && !phoneOk} aria-describedby="phone-err"
                  onChange={(e) => setMe({ ...me, phone: e.target.value })} onBlur={() => setPhoneTouched(true)} />
                {phoneTouched && !phoneOk && <span id="phone-err" className="err">{t.cart.phoneBad}</span>}
              </div>
              <div className="hp" aria-hidden="true">
                <label>Website <input ref={honeypot} name="website" tabIndex={-1} autoComplete="off" /></label>
              </div>

              <div className="opt-group">
                <h4>{t.cart.pickupTime}</h4>
                <div className="chips">
                  {([[0, t.cart.asap], [15, t.cart.in15], [30, t.cart.in30]] as const).map(([v, label]) => (
                    <button key={v} type="button" className="chip" aria-pressed={pickupInMin === v} onClick={() => setPickupInMin(v)}>{label}</button>
                  ))}
                </div>
              </div>
              <div className="opt-group">
                <h4>{t.cart.payment}</h4>
                <div className="chips">
                  <button type="button" className="chip" aria-pressed="true">{t.cart.payAtPickup}</button>
                  <button type="button" className="chip" disabled>{t.cart.onlineSoon}</button>
                </div>
              </div>

              <div className="totals"><span>{t.cart.total}</span><span className="num">{total} {t.egp}</span></div>
              {error && <p className="alert" role="alert">{t.errors[error]}</p>}
              <div className="grid gap-2">
                <button type="submit" className="btn" disabled={!canSend}>{sending ? t.cart.placing : t.cart.place}</button>
                <button type="button" className="btn alt" onClick={() => setSheet(null)}>{t.back}</button>
              </div>
            </form>
          )}
        </div>
      )}
    </>
  );
}
