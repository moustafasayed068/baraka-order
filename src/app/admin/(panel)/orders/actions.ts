"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStaff, staffDb } from "@/lib/auth";

// Managers and the owner only (RLS also limits managers to their branch); changes are audited by triggers.
export async function cancelOrder(fd: FormData) {
  await requireStaff(["owner", "manager"]);
  const p = z.object({ id: z.uuid(), reason: z.string().trim().max(200) }).parse(Object.fromEntries(fd));
  await (await staffDb()).from("orders").update({ status: "cancelled", problem: p.reason || "cancelled by manager" })
    .eq("id", p.id).not("status", "in", "(delivered,collected,cancelled)");
  revalidatePath("/admin/orders");
}

export async function setBlocked(fd: FormData) {
  await requireStaff(["owner", "manager"]);
  const p = z.object({ id: z.uuid(), blocked: z.enum(["true", "false"]) }).parse(Object.fromEntries(fd));
  await (await staffDb()).from("customers").update({ blocked: p.blocked === "true" }).eq("id", p.id);
  revalidatePath("/admin/orders");
}
