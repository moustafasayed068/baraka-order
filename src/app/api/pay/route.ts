import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { adminDb, sameOrigin } from "@/lib/db";
import { createCheckout, paymentsEnabled } from "@/lib/paymob";

// Customer payment page actions, keyed by the unguessable tracking token:
//   pay  → create a Paymob checkout for the server-side total and return its URL
//   cash → give up on online payment and send the order to the kitchen as cash
const Body = z.object({ token: z.string().regex(/^[0-9a-f]{32}$/), action: z.enum(["pay", "cash"]) });

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "invalid" }, { status: 403 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid" }, { status: 400 });
  const { token, action } = parsed.data;
  const db = adminDb();
  await db.rpc("expire_unpaid_orders");
  const { data: o } = await db.from("orders")
    .select("id, tracking_token, number, total, delivery_fee, status, customer_name, customer_phone, order_items(name_en, qty, line_total)")
    .eq("tracking_token", token).maybeSingle();
  if (!o) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (o.status !== "awaiting_payment") return NextResponse.json({ error: "not_payable", status: o.status }, { status: 409 });

  if (action === "cash") {
    const { error } = await db.from("orders").update({ payment_method: "cash", status: "received" })
      .eq("id", o.id).eq("status", "awaiting_payment");
    if (error) return NextResponse.json({ error: "server" }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (!paymentsEnabled()) return NextResponse.json({ error: "payments_off" }, { status: 503 });
  try {
    const { url, ref } = await createCheckout({ ...o, token: o.tracking_token, items: o.order_items });
    if (ref) await db.from("orders").update({ payment_ref: ref }).eq("id", o.id);
    return NextResponse.json({ url });
  } catch (e) {
    console.error("paymob checkout failed", e);
    return NextResponse.json({ error: "payment_failed" }, { status: 502 });
  }
}
