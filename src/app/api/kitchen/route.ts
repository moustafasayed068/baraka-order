import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { adminDb, getDevice, kitchenOrders, sameOrigin } from "@/lib/db";

const noStore = { headers: { "Cache-Control": "no-store" } };

export async function GET() {
  const device = await getDevice("kitchen");
  if (!device) return NextResponse.json({ error: "unpaired" }, { status: 401 });
  return NextResponse.json(await kitchenOrders(device.branch.id), noStore);
}

// Allowed moves: action -> [from status, to status, order type or null for any]
const MOVES = {
  start: ["received", "preparing", null],
  ready: ["preparing", "ready", null],
  collected: ["ready", "collected", "pickup"],
  not_collected: ["ready", "not_collected", "pickup"],
} as const;
const Body = z.union([
  z.object({ orderId: z.uuid(), action: z.enum(["start", "ready", "collected", "not_collected"]) }),
  z.object({ orderId: z.uuid(), action: z.literal("assign"), riderId: z.uuid() }), // pick / change rider until picked up
  z.object({ orderId: z.uuid(), action: z.literal("returned") }), // rider flagged a problem and brought the food back
]);

// Kitchen can only move orders of its own branch one step forward; it never touches money fields.
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const device = await getDevice("kitchen");
  if (!device) return NextResponse.json({ error: "unpaired" }, { status: 401 });
  const b = Body.safeParse(await req.json().catch(() => null));
  if (!b.success) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const db = adminDb();
  if (b.data.action === "assign") {
    const { data: rider } = await db.from("riders").select("id").eq("id", b.data.riderId).eq("branch_id", device.branch.id).eq("active", true).maybeSingle();
    if (!rider) return NextResponse.json({ error: "invalid" }, { status: 400 });
    const { data, error } = await db.from("orders").update({ rider_id: rider.id })
      .eq("id", b.data.orderId).eq("branch_id", device.branch.id).eq("type", "delivery").eq("status", "ready").select("id");
    if (error) return NextResponse.json({ error: "server" }, { status: 500 });
    return data.length ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "stale" }, { status: 409 });
  }
  if (b.data.action === "returned") {
    const { data, error } = await db.from("orders").update({ status: "cancelled" })
      .eq("id", b.data.orderId).eq("branch_id", device.branch.id).eq("status", "out_for_delivery").not("problem", "is", null).select("id, problem");
    if (error) return NextResponse.json({ error: "server" }, { status: 500 });
    if (!data.length) return NextResponse.json({ error: "stale" }, { status: 409 });
    await db.from("audit_log").insert({ action: "order_cancelled", entity: "orders", entity_id: b.data.orderId, after: { reason: data[0].problem, device: device.id } });
    return NextResponse.json({ ok: true });
  }

  const [from, to, type] = MOVES[b.data.action];
  let q = db.from("orders").update({ status: to })
    .eq("id", b.data.orderId).eq("branch_id", device.branch.id).eq("status", from);
  if (type) q = q.eq("type", type);
  const { data, error } = await q.select("id");
  if (error) return NextResponse.json({ error: "server" }, { status: 500 });
  if (!data.length) return NextResponse.json({ error: "stale" }, { status: 409 }); // already moved on another screen

  if (to === "not_collected") {
    await db.from("audit_log").insert({ action: "order_not_collected", entity: "orders", entity_id: b.data.orderId, after: { device: device.id } });
  }
  return NextResponse.json({ ok: true });
}
