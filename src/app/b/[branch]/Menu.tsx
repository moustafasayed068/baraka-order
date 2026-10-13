"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { elapsed, saveOrder, store, uuid } from "@/lib/client";
import { distanceKm, type Pt } from "@/lib/geo";
import { clockAt } from "@/lib/hours";
import { dict, pick, type ErrorCode, type Lang } from "@/lib/i18n";
import { normalizePhone, PHONE_RE } from "@/lib/phone";

type Option = { id: string; kind: "size" | "sauce"; name_ar: string; name_en: string; price_delta: number; sort: number };
export type MenuItem = {
  id: string; slug: string; category_id: string; name_ar: string; name_en: string; desc_ar: string; desc_en: string;
  base_price: number; photo_url: string | null; is_meal: boolean; sold_out: boolean; options: Option[];
};
type Category = { id: string; slug: string; name_ar: string; name_en: string };
type Line = { itemId: string; optionId: string | null; qty: number };
export type Delivery = { fee: number; min_order: number; max_km: number; branchPt: Pt | null; eta: number };
type Address = { street: string; building: string; floor: string; apartment: string; landmark: string; lat: number | null; lng: number | null };
type Saved = Partial<Record<"home" | "work", Address>>;
const EMPTY_ADDR: Address = { street: "", building: "", floor: "", apartment: "", landmark: "", lat: null, lng: null };
type Sheet = null | { kind: "cart" } | { kind: "item"; item: MenuItem; optionId: string | null; qty: number };

const MAX_QTY = 20;
// clock time `minutes` from now (the checkout sheet only renders after a tap, so this never runs during hydration)
const clockIn = (minutes: number, lang: Lang) => clockAt(Date.now() + minutes * 60_000, lang);
const unitPrice = (i: MenuItem, optionId: string | null) => i.base_price + (i.options.find((o) => o.id === optionId)?.price_delta ?? 0);

export function Menu({ lang, branch, categories, items, blocked, delivery: zone, acceptsDelivery, initialMode, onlinePay = false, wait }: {
  lang: Lang; branch: string; categories: Category[]; items: MenuItem[]; blocked: boolean;
  delivery: Delivery | null; acceptsDelivery: boolean; initialMode: "pickup" | "delivery"; onlinePay?: boolean;
  wait: number; // current kitchen estimate in minutes
}) {
  const t = dict[lang];
  const router = useRouter();
  const byId = new Map(items.map((i) => [i.id, i]));
  const [cat, setCat] = useState(categories[0]?.id);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [cart, setCart] = useState<Line[]>([]);
  const [me, setMe] = useState({ name: "", phone: "" });
  const [pickupInMin, setPickupInMin] = useState<0 | 15 | 30>(0);
  const [mode, setMode] = useState(initialMode);
  const [addr, setAddr] = useState<Address>(EMPTY_ADDR);
  const [saved, setSaved] = useState<Saved>({});
  const [saveAs, setSaveAs] = useState<"home" | "work" | null>(null);
  const [gpsMsg, setGpsMsg] = useState<string | null>(null);
  const [phoneTouched, setPhoneTouched] = useState(false);
  const [bad, setBad] = useState<Set<string>>(new Set()); // items the server rejected (sold out mid-cart)
  const [error, setError] = useState<ErrorCode | null>(null);
  const [sending, setSending] = useState(false);
  const [query, setQuery] = useState("");
  const [payOnline, setPayOnline] = useState(false);
  const [toast, setToast] = useState(0); // bumps on every add, drives the toast and the cart-bar pulse
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
    const s = store.get<Saved>("bk_addr", {});
    setSaved(s);
    const pin = store.get<Pt | null>("bk_pin", null); // from "use my location" on the home page
    const a = s.home ?? s.work ?? EMPTY_ADDR;
    setAddr(pin ? { ...a, lat: pin[0], lng: pin[1] } : a);
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
    setToast((n) => n + 1);
  }
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(0), 1600);
    return () => clearTimeout(id);
  }, [toast]);
  const qtyOf = (itemId: string) => lines.reduce((s, l) => (l.itemId === itemId ? s + l.qty : s), 0);
  function clearCart() {
    if (confirm(t.cart.clearConfirm)) { setCart([]); setSheet(null); }
  }
  const changeQty = (idx: number, d: number) =>
    setCart((c) => c.map((l, j) => (j === idx ? { ...l, qty: Math.min(MAX_QTY, l.qty + d) } : l)).filter((l) => l.qty > 0));

  const phone = normalizePhone(me.phone);
  const phoneOk = PHONE_RE.test(phone);
  const nameOk = me.name.trim().length >= 2;
  const hasBad = lines.some((l) => isOut(l.itemId));
  const delivery = mode === "delivery";
  const fee = delivery && zone ? zone.fee : 0;
  const short = delivery && zone ? Math.max(0, zone.min_order - total) : 0;
  const tooFar = delivery && !!zone?.branchPt && addr.lat !== null && addr.lng !== null && distanceKm([addr.lat, addr.lng], zone.branchPt) > zone.max_km;
  const deliveryOk = !delivery || (acceptsDelivery && !!zone && short === 0 && !tooFar && addr.street.trim().length >= 3);
  const canSend = !blocked && !sending && lines.length > 0 && nameOk && phoneOk && !hasBad && deliveryOk;

  // keep the choice in the URL so a delivery link can be shared or reopened
  function chooseMode(m: "pickup" | "delivery") {
    setMode(m);
    history.replaceState(null, "", m === "delivery" ? "?mode=delivery" : location.pathname);
  }
  function pin() {
    setGpsMsg(null);
    if (!navigator.geolocation || !window.isSecureContext) return setGpsMsg(t.delivery.gpsFail);
    navigator.geolocation.getCurrentPosition(
      (p) => setAddr((a) => ({ ...a, lat: +p.coords.latitude.toFixed(6), lng: +p.coords.longitude.toFixed(6) })),
      () => setGpsMsg(t.delivery.gpsFail),
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }
  const setField = (k: keyof Address) => (e: React.ChangeEvent<HTMLInputElement>) => setAddr({ ...addr, [k]: e.target.value });

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
          branch, idempotencyKey: idemKey.current, type: mode, name: me.name.trim(), phone,
          paymentMethod: onlinePay && payOnline ? "online" : "cash",
          ...(delivery ? { pickupInMin: 0, address: addr } : { pickupInMin }),
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
      if (delivery && saveAs) store.set("bk_addr", { ...saved, [saveAs]: addr });
      setCart([]);
      store.set(`bk_cart_${branch}`, []);
      router.push(data.pay ? `/pay/${data.token}` : `/t/${data.token}`);
    } catch {
      setError("network"); // same idempotency key on retry, so a lost response never doubles the order
    } finally {
      setSending(false);
    }
  }

  // search looks across every category, in both languages
  const q = query.trim().toLowerCase();
  const shown = q
    ? items.filter((i) => [i.name_ar, i.name_en, i.desc_ar, i.desc_en, ...i.options.flatMap((o) => [o.name_ar, o.name_en])]
        .some((x) => x?.toLowerCase().includes(q)))
    : items.filter((i) => i.category_id === cat);
  const isExtras = !q && categories.find((c) => c.id === cat)?.slug === "extras";
  const openItem = (m: MenuItem) => setSheet({ kind: "item", item: m, optionId: m.options[0]?.id ?? null, qty: 1 });

  return (
    <>
      <div className="px-3.5 pt-3">
        <div className="seg" role="group">
          <button type="button" aria-pressed={!delivery} onClick={() => chooseMode("pickup")}>{t.delivery.pickup}</button>
          <button type="button" aria-pressed={delivery} onClick={() => chooseMode("delivery")}>{t.delivery.delivery}</button>
        </div>
        {delivery && (!acceptsDelivery || !zone ? (
          <div className="banner mx-0! mb-0!">
            {acceptsDelivery ? t.delivery.noZones : t.delivery.paused}
            <button type="button" className="btn alt mt-2" onClick={() => chooseMode("pickup")}>{t.delivery.usePickup}</button>
          </div>
        ) : (
          <p className="mt-2 text-sm text-muted num">
            {t.delivery.fee} {zone.fee} {t.egp} · {t.delivery.minOrder(zone.min_order)} · {t.delivery.eta(zone.eta)}
          </p>
        ))}
        {tooFar && <p className="banner mx-0! mb-0!">{t.delivery.tooFar}</p>}
      </div>

      <div className="cats-wrap">
        <label className="search">
          <span aria-hidden="true">⌕</span>
          <input type="search" value={query} placeholder={t.menu.search} aria-label={t.menu.search}
            onChange={(e) => setQuery(e.target.value)} enterKeyHint="search" />
          {query && <button type="button" aria-label="×" onClick={() => setQuery("")}>×</button>}
        </label>
        {!q && (
          <nav className="cats" aria-label="menu">
            {categories.map((c) => (
              <button key={c.id} type="button" aria-pressed={cat === c.id} onClick={() => setCat(c.id)}>{pick(c, lang)}</button>
            ))}
          </nav>
        )}
      </div>

      <main className="menu">
        {q && shown.length === 0 && <p className="text-center text-muted py-8">{t.menu.noResults}</p>}
        {isExtras ? (
          <div className="extras">
            {shown.map((x) => (
              <button key={x.id} type="button" className="extra" disabled={isOut(x.id)} onClick={() => add(x.id, null)}>
                <span>{pick(x, lang)}{isOut(x.id) && <> <span className="tag">{t.menu.soldOut}</span></>}</span>
                <span className="flex items-center gap-1.5">
                  <span className="price num">{x.base_price}</span>
                  {qtyOf(x.id) > 0 ? <span className="incart num" aria-label={t.menu.inCart(qtyOf(x.id))}>{qtyOf(x.id)}</span> : <span className="add sm" aria-hidden="true">+</span>}
                </span>
              </button>
            ))}
          </div>
        ) : (
          shown.map((m) => (
            <button key={m.id} type="button" className="item" disabled={isOut(m.id)} onClick={() => openItem(m)}>
              <div className="plate">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {m.photo_url ? <img src={m.photo_url} alt="" loading="lazy" /> : m.name_ar}
              </div>
              <div>
                <h3>{pick(m, lang)} {isOut(m.id) && <span className="tag">{t.menu.soldOut}</span>}</h3>
                <p>{lang === "ar" ? m.desc_ar : m.desc_en}</p>
                <div className="pr">
                  <span className="price num">{m.options.some((o) => o.price_delta) && t.menu.from}{m.base_price}<small>{t.egp}</small></span>
                  {qtyOf(m.id) > 0
                    ? <span className="incart num" aria-label={t.menu.inCart(qtyOf(m.id))}>{qtyOf(m.id)}</span>
                    : <span className="add" aria-hidden="true">+</span>}
                </div>
              </div>
            </button>
          ))
        )}
      </main>

      {toast > 0 && <div className="toast" role="status">{t.menu.added}</div>}
      {count > 0 && (
        <button key={toast} type="button" className={`cartbar ${toast ? "bump" : ""}`} onClick={() => setSheet({ kind: "cart" })}>
          <span><span className="count num">{count}</span>{t.menu.viewCart}</span>
          <span className="num">{total} {t.egp}</span>
        </button>
      )}

      {sheet && (
        <div className="sheet-bg" onClick={(e) => e.target === e.currentTarget && setSheet(null)}>
          {sheet.kind === "item" ? (
            <div className="sheet" role="dialog" aria-modal="true" aria-label={pick(sheet.item, lang)}>
              <div className="grab" aria-hidden="true" />
              {sheet.item.photo_url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img className="sheet-photo" src={sheet.item.photo_url} alt="" />
              )}
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
              <div className="grab" aria-hidden="true" />
              <div className="flex items-baseline justify-between gap-2">
                <h3>{t.cart.title}</h3>
                {lines.length > 0 && <button type="button" className="linkish" onClick={clearCart}>{t.cart.clear}</button>}
              </div>
              <p className="sec">{t.cart.yourItems} · <span className="num">{t.cart.itemsCount(count)}</span></p>
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

              <p className="sec mt-4">{t.cart.details}</p>
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
              {delivery && (
                <fieldset className="opt-group">
                  <h4>{t.delivery.address}</h4>
                  {(saved.home || saved.work) && (
                    <div className="chips mb-2" aria-label={t.delivery.saved}>
                      {(["home", "work"] as const).map((k) => saved[k] && (
                        <button key={k} type="button" className="chip" onClick={() => setAddr(saved[k]!)}>{t.delivery[k]}</button>
                      ))}
                    </div>
                  )}
                  <div className="field">
                    <label htmlFor="f-street">{t.delivery.street}</label>
                    <input id="f-street" autoComplete="street-address" maxLength={120} value={addr.street} onChange={setField("street")} />
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div className="field my-0!"><label htmlFor="f-bld">{t.delivery.building}</label><input id="f-bld" maxLength={40} value={addr.building} onChange={setField("building")} /></div>
                    <div className="field my-0!"><label htmlFor="f-floor">{t.delivery.floor}</label><input id="f-floor" maxLength={10} value={addr.floor} onChange={setField("floor")} /></div>
                    <div className="field my-0!"><label htmlFor="f-apt">{t.delivery.apartment}</label><input id="f-apt" maxLength={10} value={addr.apartment} onChange={setField("apartment")} /></div>
                  </div>
                  <div className="field">
                    <label htmlFor="f-landmark">{t.delivery.landmark}</label>
                    <input id="f-landmark" maxLength={120} placeholder={t.delivery.landmarkPh} value={addr.landmark} onChange={setField("landmark")} />
                  </div>
                  <button type="button" className="chip w-full" onClick={pin}>{addr.lat !== null ? t.delivery.pinSet : t.delivery.pinAdd}</button>
                  {gpsMsg && <p className="err mt-1">{gpsMsg}</p>}
                  <h4 className="mt-3">{t.delivery.saveAs}</h4>
                  <div className="chips">
                    {([["home", t.delivery.home], ["work", t.delivery.work], [null, t.delivery.noSave]] as const).map(([k, label]) => (
                      <button key={label} type="button" className="chip" aria-pressed={saveAs === k} onClick={() => setSaveAs(k)}>{label}</button>
                    ))}
                  </div>
                </fieldset>
              )}

              <div className="hp" aria-hidden="true">
                <label>Website <input ref={honeypot} name="website" tabIndex={-1} autoComplete="off" /></label>
              </div>

              {!delivery && (
                <div className="opt-group">
                  <h4>{t.cart.pickupTime}</h4>
                  <div className="chips">
                    {([[0, t.cart.asap], [15, t.cart.in15], [30, t.cart.in30]] as const).map(([v, label]) => (
                      <button key={v} type="button" className="chip" aria-pressed={pickupInMin === v} onClick={() => setPickupInMin(v)}>{label}</button>
                    ))}
                  </div>
                  <p className="ready-hint num" role="status">⏱ {t.cart.readyAt(clockIn(Math.max(wait, pickupInMin), lang), Math.max(wait, pickupInMin))}</p>
                </div>
              )}
              {delivery && zone && (
                <p className="ready-hint num" role="status">🛵 {t.cart.arriveAt(clockIn(zone.eta, lang), zone.eta)}</p>
              )}
              <div className="opt-group">
                <h4>{t.cart.payment}</h4>
                <div className="chips">
                  <button type="button" className="chip" aria-pressed={!onlinePay || !payOnline} onClick={() => setPayOnline(false)}>{delivery ? t.delivery.payCod : t.cart.payAtPickup}</button>
                  {onlinePay
                    ? <button type="button" className="chip" aria-pressed={payOnline} onClick={() => setPayOnline(true)}>💳 {t.pay.online}</button>
                    : <button type="button" className="chip" disabled>{t.cart.onlineSoon}</button>}
                </div>
              </div>

              {delivery && zone && (
                <div className="grid gap-1 text-sm">
                  <div className="flex justify-between"><span>{t.delivery.subtotal}</span><span className="num">{total} {t.egp}</span></div>
                  <div className="flex justify-between"><span>{t.delivery.fee}</span><span className="num">{fee} {t.egp}</span></div>
                </div>
              )}
              <div className="totals sticky-total"><span>{t.cart.total}</span><span className="num">{total + fee} {t.egp}</span></div>
              {tooFar && <p className="alert">{t.delivery.tooFar}</p>}
              {short > 0 && <p className="alert">{t.delivery.minOrder(zone!.min_order)} — {t.delivery.addMore(short)}</p>}
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
