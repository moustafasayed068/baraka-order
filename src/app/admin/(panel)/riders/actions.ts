"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionResult } from "@/components/ActionForm";
import { rolesFor } from "@/lib/admin-nav";
import { requireStaff, staffDb } from "@/lib/auth";
import { normalizePhone, PHONE_RE } from "@/lib/phone";

const Rider = z.object({
  id: z.uuid().optional(),
  branch_id: z.uuid(),
  name: z.string().trim().min(2).max(60),
  phone: z.string().transform(normalizePhone).pipe(z.string().regex(PHONE_RE)),
  pin: z.string().regex(/^\d{4,8}$/).optional().or(z.literal("").transform(() => undefined)),
  active: z.literal("on").optional(),
});

// save_rider checks the manager's branch and hashes the PIN inside the database.
export async function saveRider(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const staff = await requireStaff(rolesFor("riders"));
  const raw = Object.fromEntries(fd);
  if (staff.role !== "owner") raw.branch_id = staff.branchId!; // managers can only use their own branch
  const p = Rider.safeParse(raw);
  if (!p.success) return { error: p.error.issues.some((i) => i.path[0] === "pin") ? "badPin" : "invalid" };
  const r = p.data;
  if (!r.id && !r.pin) return { error: "badPin" };
  const { error } = await (await staffDb()).rpc("save_rider", {
    p_id: r.id ?? null, p_branch: r.branch_id, p_name: r.name, p_phone: r.phone, p_pin: r.pin ?? null, p_active: !r.id || !!r.active,
  });
  if (error) return { error: error.code === "23505" ? "duplicatePhone" : "error" };
  revalidatePath("/admin/riders");
  return { ok: true };
}
