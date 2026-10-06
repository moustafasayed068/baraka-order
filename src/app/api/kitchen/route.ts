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
  // ponytail: kitchen hands delivery orders out until rider assignment exists (build step 5)
  dispatch: ["ready", "out_for_delivery", "delivery"],
} as const;
const Body = z.object({ orderId: z.uuid(), action: z.enum(["start", "ready", "collected", "not_collected", "dispatch"]) });

// Kitchen can only move orders of its own branch one step forward; it never touches money fields.
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const device = await getDevice("kitchen");
  if (!device) return NextResponse.json({ error: "unpaired" }, { status: 401 });
  const b = Body.safeParse(await req.json().catch(() => null));
  if (!b.success) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const [from, to, type] = MOVES[b.data.action];
  let q = adminDb().from("orders").update({ status: to })
    .eq("id", b.data.orderId).eq("branch_id", device.branch.id).eq("status", from);
  if (type) q = q.eq("type", type);
  const { data, error } = await q.select("id");
  if (error) return NextResponse.json({ error: "server" }, { status: 500 });
  if (!data.length) return NextResponse.json({ error: "stale" }, { status: 409 }); // already moved on another screen

  if (to === "not_collected") {
    await adminDb().from("audit_log").insert({ action: "order_not_collected", entity: "orders", entity_id: b.data.orderId, after: { device: device.id } });
  }
  return NextResponse.json({ ok: true });
}
