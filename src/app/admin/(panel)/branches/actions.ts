"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionResult } from "@/components/ActionForm";
import { rolesFor } from "@/lib/admin-nav";
import { requireStaff, staffDb } from "@/lib/auth";

// Every write runs as the signed-in staff member, so RLS limits managers to their own branch.
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const Settings = z.object({
  id: z.uuid(),
  opens_at: time,
  closes_at: time,
  accepts_orders: z.literal("on").optional(),
  accepts_delivery: z.literal("on").optional(),
  extra_wait_min: z.coerce.number().int().min(0).max(120),
  lat: z.coerce.number().min(22).max(32), // Egypt
  lng: z.coerce.number().min(24).max(37),
});

function done(failed: unknown): ActionResult {
  if (failed) return { error: "error" };
  revalidatePath("/admin/branches");
  return { ok: true };
}

export async function saveBranch(_: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireStaff(rolesFor("branches"));
  const p = Settings.safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: "invalid" };
  const { id, accepts_orders, accepts_delivery, ...rest } = p.data;
  const { data, error } = await (await staffDb()).from("branches")
    .update({ ...rest, accepts_orders: !!accepts_orders, accepts_delivery: !!accepts_delivery }).eq("id", id).select("id");
  return done(error || !data?.length);
}

// One-tap busy controls
export async function busyAction(fd: FormData) {
  await requireStaff(rolesFor("branches"));
  const id = z.uuid().parse(fd.get("id"));
  const what = z.enum(["pause", "resume", "plus10", "reset"]).parse(fd.get("what"));
  const db = await staffDb();
  if (what === "pause" || what === "resume") await db.from("branches").update({ accepts_orders: what === "resume" }).eq("id", id);
  else {
    const { data } = await db.from("branches").select("extra_wait_min").eq("id", id).single();
    await db.from("branches").update({ extra_wait_min: what === "reset" ? 0 : Math.min(120, (data?.extra_wait_min ?? 0) + 10) }).eq("id", id);
  }
  revalidatePath("/admin/branches");
}

const Zone = z.object({
  id: z.uuid(),
  fee: z.coerce.number().int().min(0).max(1000),
  min_order: z.coerce.number().int().min(0).max(10000),
  max_km: z.coerce.number().min(0.5).max(50),
});
export async function saveDelivery(_: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireStaff(rolesFor("branches"));
  const p = Zone.safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: "invalid" };
  const { id, ...rest } = p.data;
  const { data, error } = await (await staffDb()).from("delivery_zones").update({ ...rest, is_sample: false }).eq("id", id).select("id");
  return done(error || !data?.length);
}

export async function setPin(_: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireStaff(rolesFor("branches"));
  const p = z.object({ id: z.uuid(), pin: z.string().regex(/^\d{4,8}$/) }).safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: "invalid" };
  const { error } = await (await staffDb()).rpc("set_branch_pin", { p_branch: p.data.id, p_pin: p.data.pin });
  return done(error);
}

export async function revokeDevice(fd: FormData) {
  await requireStaff(rolesFor("branches"));
  await (await staffDb()).from("devices").update({ revoked_at: new Date().toISOString() }).eq("id", z.uuid().parse(fd.get("id")));
  revalidatePath("/admin/branches");
}
