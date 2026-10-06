import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { adminDb, getBranch } from "@/lib/db";
import { isOpenAt } from "@/lib/hours";
import { priceLines, type DbItem } from "@/lib/pricing";
import type { ErrorCode } from "@/lib/i18n";

import { PHONE_RE } from "@/lib/phone";

const Body = z.object({
  branch: z.string().regex(/^[a-z0-9-]{2,40}$/),
  idempotencyKey: z.uuid(),
  type: z.literal("pickup"), // delivery arrives in build step 4
  name: z.string().trim().min(2).max(40),
  phone: z.string().regex(PHONE_RE),
  pickupInMin: z.union([z.literal(0), z.literal(15), z.literal(30)]),
  lines: z.array(z.object({ itemId: z.uuid(), optionId: z.uuid().nullable(), qty: z.int().min(1).max(20) })).min(1).max(30),
  website: z.string().max(0), // honeypot: real people never see this field
  fillMs: z.number().min(1500), // basic bot check: nobody fills a checkout in under 1.5 s
});

const fail = (error: ErrorCode, status = 400, extra?: object) => NextResponse.json({ error, ...extra }, { status });

export async function POST(req: NextRequest) {
  // CSRF: only accept requests from our own pages
  const origin = req.headers.get("origin");
  if (!origin || new URL(origin).host !== req.headers.get("host")) return fail("invalid", 403);

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("invalid");
  const b = parsed.data;
  const db = adminDb();

  // Retry / double tap: hand back the same order before any other check
  const { data: existing } = await db.from("orders").select("tracking_token, number").eq("idempotency_key", b.idempotencyKey).maybeSingle();
  if (existing) return NextResponse.json({ token: existing.tracking_token, number: existing.number });

  const branch = await getBranch(b.branch);
  if (!branch) return fail("invalid");
  if (!branch.accepts_orders) return fail("paused", 409);
  if (!isOpenAt(branch.opens_at, branch.closes_at)) return fail("closed", 409);

  const { data: customer } = await db.from("customers").select("blocked").eq("phone", b.phone).maybeSingle();
  if (customer?.blocked) return fail("blocked", 403);

  // Abuse limits, counted from orders themselves.
  // ponytail: count-then-insert can let a burst of parallel requests slip one or two over; move to a locked counter if abused
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || null;
  const hourAgo = new Date(Date.now() - 3600_000).toISOString();
  const [byPhone, byIp, active] = await Promise.all([
    db.from("orders").select("id", { count: "exact", head: true }).eq("customer_phone", b.phone).gte("created_at", hourAgo),
    ip ? db.from("orders").select("id", { count: "exact", head: true }).eq("client_ip", ip).gte("created_at", hourAgo) : { count: 0 },
    db.from("orders").select("id", { count: "exact", head: true }).eq("customer_phone", b.phone).in("status", ["received", "preparing", "ready", "out_for_delivery"]),
  ]);
  if ((byPhone.count ?? 0) >= 5 || (byIp.count ?? 0) >= 20) return fail("rate_limited", 429);
  if ((active.count ?? 0) >= 3) return fail("too_many_active", 429);

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

  const { data, error } = await db.rpc("create_order", {
    p_order: {
      branch_id: branch.id,
      idempotency_key: b.idempotencyKey,
      type: b.type,
      customer_name: b.name,
      customer_phone: b.phone,
      subtotal: priced.subtotal,
      delivery_fee: 0,
      total: priced.subtotal,
      pickup_in_min: b.pickupInMin,
      client_ip: ip,
    },
    p_items: priced.lines,
  });
  if (error || !data?.[0]) {
    console.error("create_order failed", error);
    return fail("server", 500);
  }
  return NextResponse.json({ token: data[0].tracking_token, number: data[0].number }, { status: data[0].created ? 201 : 200 });
}
