import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { adminDb, getRider, riderView, sameOrigin } from "@/lib/db";

export async function GET() {
  const rider = await getRider();
  if (!rider) return NextResponse.json({ error: "signed_out" }, { status: 401 });
  return NextResponse.json(await riderView(rider.id, rider.shiftStart), { headers: { "Cache-Control": "no-store" } });
}

const Body = z.discriminatedUnion("action", [
  z.object({ orderId: z.uuid(), action: z.literal("picked_up") }),
  z.object({ orderId: z.uuid(), action: z.literal("delivered") }),
  z.object({ orderId: z.uuid(), action: z.literal("problem"), problem: z.enum(["no_answer", "wrong_address", "refused"]) }),
]);

// Riders can only move their own orders, and only status/problem (never money or assignment).
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const rider = await getRider();
  if (!rider) return NextResponse.json({ error: "signed_out" }, { status: 401 });
  const b = Body.safeParse(await req.json().catch(() => null));
  if (!b.success) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const q = adminDb().from("orders");
  const mine = (u: ReturnType<typeof q.update>) => u.eq("id", b.data.orderId).eq("rider_id", rider.id).eq("type", "delivery");
  const res =
    b.data.action === "picked_up" ? await mine(q.update({ status: "out_for_delivery", problem: null })).eq("status", "ready").select("id")
    : b.data.action === "delivered" ? await mine(q.update({ status: "delivered", problem: null })).eq("status", "out_for_delivery").select("id")
    : await mine(q.update({ problem: b.data.problem })).in("status", ["ready", "out_for_delivery"]).select("id");
  if (res.error) return NextResponse.json({ error: "server" }, { status: 500 });
  if (!res.data.length) return NextResponse.json({ error: "stale" }, { status: 409 });
  if (b.data.action === "problem") {
    await adminDb().from("audit_log").insert({ action: "delivery_problem", entity: "orders", entity_id: b.data.orderId, after: { problem: b.data.problem, rider: rider.id } });
  }
  return NextResponse.json({ ok: true });
}
