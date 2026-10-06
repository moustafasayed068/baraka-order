"use server";
import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { rolesFor } from "@/lib/admin-nav";
import { requireStaff } from "@/lib/auth";
import { adminDb } from "@/lib/db";

export type StaffResult = { ok?: boolean; error?: string; password?: string } | null;

const NewStaff = z.object({
  email: z.email().max(200),
  name: z.string().trim().min(2).max(60),
  role: z.enum(["owner", "manager", "cashier", "callcentre"]),
  branch_id: z.uuid().optional(),
}).refine((s) => s.role === "owner" || !!s.branch_id);

// Owner only. Creating logins needs the auth admin API (service role), so the owner check
// (signed in + 2FA) happens first in requireStaff.
export async function addStaff(_: StaffResult, fd: FormData): Promise<StaffResult> {
  const owner = await requireStaff(rolesFor("staff"));
  const p = NewStaff.safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: "invalid" };
  const db = adminDb();
  const password = randomBytes(12).toString("base64url");
  const { data, error } = await db.auth.admin.createUser({ email: p.data.email, password, email_confirm: true });
  if (error) return { error: error.code === "email_exists" ? "emailTaken" : "error" };
  const { error: e2 } = await db.from("staff").insert({
    user_id: data.user.id, role: p.data.role, name: p.data.name, branch_id: p.data.role === "owner" ? null : p.data.branch_id,
  });
  if (e2) {
    await db.auth.admin.deleteUser(data.user.id);
    return { error: "error" };
  }
  await db.from("audit_log").insert({ actor: owner.userId, action: "staff_added", entity: "staff", entity_id: data.user.id, after: { role: p.data.role, email: p.data.email } });
  revalidatePath("/admin/staff");
  return { ok: true, password }; // shown once to the owner, never stored in plain text
}

// Lost phone: remove the person's authenticator; they scan a new QR at the next sign-in.
// The owner can't reset themselves here (use scripts/reset-2fa.mjs), so an owner can't be locked out by a mistake.
export async function resetStaff2fa(fd: FormData) {
  const owner = await requireStaff(rolesFor("staff"));
  const id = z.uuid().parse(fd.get("id"));
  if (id === owner.userId) return;
  const db = adminDb();
  const { data } = await db.auth.admin.mfa.listFactors({ userId: id });
  for (const f of data?.factors ?? []) await db.auth.admin.mfa.deleteFactor({ userId: id, id: f.id });
  await db.from("audit_log").insert({ actor: owner.userId, action: "staff_2fa_reset", entity: "staff", entity_id: id });
  revalidatePath("/admin/staff");
}

export async function removeStaff(fd: FormData) {
  const owner = await requireStaff(rolesFor("staff"));
  const id = z.uuid().parse(fd.get("id"));
  if (id === owner.userId) return; // can't remove yourself
  const db = adminDb();
  await db.from("audit_log").insert({ actor: owner.userId, action: "staff_removed", entity: "staff", entity_id: id });
  await db.auth.admin.deleteUser(id); // staff row goes with it (on delete cascade); sessions end
  revalidatePath("/admin/staff");
}
