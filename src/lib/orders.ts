import "server-only";
import { z } from "zod";
import { adminDb, getBranch } from "./db";
import { distanceKm } from "./geo";
import { isOpenAt } from "./hours";
import type { ErrorCode } from "./i18n";
import { PHONE_RE } from "./phone";
import { priceLines, type DbItem } from "./pricing";

// One order path for the customer site and the call centre: same validation, same server-side prices.

const text = (max: number) => z.string().trim().max(max);
const Address = z.object({
  street: z.string().trim().min(3).max(120),
  building: text(40),
  floor: text(10),
  apartment: text(10),
  landmark: text(120),
  lat: z.number().min(-90).max(90).nullable(),
  lng: z.number().min(-180).max(180).nullable(),
});
const Common = z.object({
  branch: z.string().regex(/^[a-z0-9-]{2,40}$/),
  idempotencyKey: z.uuid(),
  name: z.string().trim().min(2).max(40),
  phone: z.string().regex(PHONE_RE),
  pickupInMin: z.union([z.literal(0), z.literal(15), z.literal(30)]),
  lines: z.array(z.object({ itemId: z.uuid(), optionId: z.uuid().nullable(), qty: z.int().min(1).max(20) })).min(1).max(30),
});
export const OrderInput = z.discriminatedUnion("type", [
  Common.extend({ type: z.literal("pickup") }),
  Common.extend({ type: z.literal("delivery"), address: Address, pickupInMin: z.literal(0) }),
]);
export type OrderInput = z.infer<typeof OrderInput>;

export type PlaceResult =
  | { ok: true; token: string; number: number; created: boolean }
  | { ok: false; error: ErrorCode; status: number; extra?: object };

const fail = (error: ErrorCode, status = 400, extra?: object): PlaceResult => ({ ok: false, error, status, extra });

// staff: set for call-centre orders (no customer rate limits; staff already spoke to the customer)
export async function placeOrder(b: OrderInput, ctx: { ip: string | null; staff?: { userId: string } }): Promise<PlaceResult> {
  const db = adminDb();

  // Retry / double tap: hand back the same order before any other check
  const { data: existing } = await db.from("orders").select("tracking_token, number").eq("idempotency_key", b.idempotencyKey).maybeSingle();
  if (existing) return { ok: true, token: existing.tracking_token, number: existing.number, created: false };

  const branch = await getBranch(b.branch);
  if (!branch) return fail("invalid");
  if (!branch.accepts_orders) return fail("paused", 409);
  if (!isOpenAt(branch.opens_at, branch.closes_at)) return fail("closed", 409);
  if (b.type === "delivery" && !branch.accepts_delivery) return fail("delivery_paused", 409);

  const { data: customer } = await db.from("customers").select("blocked").eq("phone", b.phone).maybeSingle();
  if (customer?.blocked) return fail("blocked", 403);

  if (!ctx.staff) {
    // Abuse limits, counted from orders themselves.
    // ponytail: count-then-insert can let a burst of parallel requests slip one or two over; move to a locked counter if abused
    const hourAgo = new Date(Date.now() - 3600_000).toISOString();
    const [byPhone, byIp, active] = await Promise.all([
      db.from("orders").select("id", { count: "exact", head: true }).eq("customer_phone", b.phone).gte("created_at", hourAgo),
      ctx.ip ? db.from("orders").select("id", { count: "exact", head: true }).eq("client_ip", ctx.ip).gte("created_at", hourAgo) : { count: 0 },
      db.from("orders").select("id", { count: "exact", head: true }).eq("customer_phone", b.phone).in("status", ["received", "preparing", "ready", "out_for_delivery"]),
    ]);
    if ((byPhone.count ?? 0) >= 5 || (byIp.count ?? 0) >= 20) return fail("rate_limited", 429);
    if ((active.count ?? 0) >= 3) return fail("too_many_active", 429);
  }

  // Prices come from the database only
  const itemIds = [...new Set(b.lines.map((l) => l.itemId))];
  const [{ data: items, error: itemsErr }, { data: soldOut }] = await Promise.all([
    db.from("menu_items").select("id, name_ar, name_en, base_price, active, item_options(id, name_ar, name_en, price_delta, active)").in("id", itemIds),
    db.from("branch_item_status").select("item_id").eq("branch_id", branch.id).eq("sold_out", true).in("item_id", itemIds),
  ]);
  if (itemsErr) return fail("server", 500);
  const priced = priceLines(b.lines, new Map((items as DbItem[]).map((i) => [i.id, i])));
  if (!priced.ok) return priced.error === "bad_option" ? fail("invalid") : fail("item_unavailable", 409, { itemIds: [priced.itemId] });
  if (soldOut?.length) return fail("sold_out", 409, { itemIds: soldOut.map((s) => s.item_id) });

  // Delivery: fee, minimum and range come from the branch's delivery settings in the database
  let fee = 0, zoneId: string | null = null, needsCallConfirm = false;
  if (b.type === "delivery") {
    const [{ data: zones }, { count: delivered }] = await Promise.all([
      db.from("delivery_zones").select("id, fee, min_order, max_km").eq("branch_id", branch.id).eq("active", true).order("fee"),
      db.from("orders").select("id", { count: "exact", head: true }).eq("customer_phone", b.phone).eq("type", "delivery").eq("status", "delivered"),
    ]);
    const { lat, lng } = b.address;
    const pinned = lat !== null && lng !== null && branch.lat !== null && branch.lng !== null;
    const km = pinned ? distanceKm([lat, lng], [branch.lat!, branch.lng!]) : 0;
    const zone = zones?.find((z) => km <= Number(z.max_km)); // cheapest setting that reaches the pin
    if (!zones?.length) return fail("zone_invalid", 409);
    if (!zone) return fail("too_far", 409);
    if (priced.subtotal < zone.min_order) return fail("below_minimum", 409, { minOrder: zone.min_order });
    fee = zone.fee;
    zoneId = zone.id;
    // kitchen calls to confirm: first delivery from this phone (until SMS OTP, phase 2) or no location pin to check range.
    // Not for call-centre orders: staff already spoke to the customer.
    needsCallConfirm = !ctx.staff && (!delivered || !pinned);
  }

  const { data, error } = await db.rpc("create_order", {
    p_order: {
      branch_id: branch.id,
      idempotency_key: b.idempotencyKey,
      type: b.type,
      customer_name: b.name,
      customer_phone: b.phone,
      subtotal: priced.subtotal,
      delivery_fee: fee,
      total: priced.subtotal + fee,
      zone_id: zoneId,
      address: b.type === "delivery" ? b.address : null,
      needs_call_confirm: needsCallConfirm,
      pickup_in_min: b.pickupInMin,
      client_ip: ctx.ip,
      source: ctx.staff ? "callcentre" : "web",
      created_by: ctx.staff?.userId ?? null,
    },
    p_items: priced.lines,
  });
  if (error || !data?.[0]) {
    console.error("create_order failed", error);
    return fail("server", 500);
  }
  return { ok: true, token: data[0].tracking_token, number: data[0].number, created: data[0].created };
}
