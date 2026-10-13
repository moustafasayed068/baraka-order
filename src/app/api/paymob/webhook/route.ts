import { NextResponse, type NextRequest } from "next/server";
import { adminDb } from "@/lib/db";
import { verifyHmac } from "@/lib/paymob";

// Paymob "transaction processed" callback. The ONLY place an order becomes paid.
// Verifies the HMAC, then record_payment checks amount + currency and processes each transaction once.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const obj = body?.obj;
  if (body?.type !== "TRANSACTION" || !obj) return NextResponse.json({ ok: true }); // other event types: acknowledge, ignore
  if (!verifyHmac(obj, req.nextUrl.searchParams.get("hmac"))) {
    console.warn("paymob webhook: bad hmac", obj?.id);
    return NextResponse.json({ error: "bad_hmac" }, { status: 401 });
  }
  const success = obj.success === true && obj.pending === false && obj.is_voided !== true && obj.is_refunded !== true;
  const { data, error } = await adminDb().rpc("record_payment", {
    p_ref: obj.order?.id != null ? String(obj.order.id) : null,
    p_merchant_ref: String(obj.order?.merchant_order_id ?? obj.special_reference ?? ""),
    p_txn: String(obj.id),
    p_amount_cents: Number(obj.amount_cents),
    p_currency: String(obj.currency),
    p_success: success,
    p_raw: body,
  });
  if (error) {
    console.error("paymob webhook: record_payment failed", error);
    return NextResponse.json({ error: "server" }, { status: 500 }); // Paymob retries
  }
  if (data === "mismatch" || data === "unknown_order") console.error("paymob webhook:", data, obj.id);
  return NextResponse.json({ ok: true, result: data });
}

// Paymob may also hit the callback with GET (browser redirect). Never trusted: send people to the home page.
export function GET(req: NextRequest) {
  return NextResponse.redirect(new URL("/", req.url));
}
