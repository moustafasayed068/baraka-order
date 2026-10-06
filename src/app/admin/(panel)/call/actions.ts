"use server";
import { headers } from "next/headers";
import { rolesFor } from "@/lib/admin-nav";
import { requireStaff } from "@/lib/auth";
import { adminDb } from "@/lib/db";
import type { ErrorCode } from "@/lib/i18n";
import { OrderInput, placeOrder } from "@/lib/orders";

export type PhoneOrderResult = { ok: true; number: number; link: string } | { ok: false; error: ErrorCode };

// Hotline orders: same validation and server-side prices as the customer site (placeOrder).
export async function placePhoneOrder(input: unknown): Promise<PhoneOrderResult> {
  const staff = await requireStaff(rolesFor("callcentre"));
  const p = OrderInput.safeParse(input);
  if (!p.success) return { ok: false, error: "invalid" };

  // Owner and call-centre agents take orders for any branch; managers and cashiers only for their own.
  if (staff.role === "manager" || staff.role === "cashier") {
    const { data } = await adminDb().from("branches").select("id").eq("slug", p.data.branch).maybeSingle();
    if (data?.id !== staff.branchId) return { ok: false, error: "invalid" };
  }

  const r = await placeOrder(p.data, { ip: null, staff: { userId: staff.userId } });
  if (!r.ok) return { ok: false, error: r.error };
  if (r.created) {
    await adminDb().from("audit_log").insert({ actor: staff.userId, action: "phone_order", entity: "orders", entity_id: `${p.data.branch}#${r.number}`, after: { number: r.number, branch: p.data.branch } });
  }
  const h = await headers();
  return { ok: true, number: r.number, link: `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}/t/${r.token}` };
}
