"use server";
import { revalidatePath } from "next/cache";
import sharp from "sharp";
import { z } from "zod";
import type { ActionResult } from "@/components/ActionForm";
import { rolesFor } from "@/lib/admin-nav";
import { requireStaff, staffDb } from "@/lib/auth";

// Owner only; writes go through RLS (owner + 2FA) and every change lands in the audit log via triggers.
const text = (max: number) => z.string().trim().max(max);
const on = z.literal("on").optional();

const Item = z.object({
  id: z.uuid().optional(),
  category_id: z.uuid(),
  name_ar: text(80).min(2),
  name_en: text(80).min(2),
  desc_ar: text(300),
  desc_en: text(300),
  base_price: z.coerce.number().int().min(0).max(100000),
  sort: z.coerce.number().int().min(0).max(999),
  is_meal: on,
  active: on,
});

function done(failed: unknown): ActionResult {
  if (failed) return { error: "error" };
  revalidatePath("/admin/menu");
  revalidatePath("/b/[branch]", "page"); // customer menus show the change right away
  return { ok: true };
}

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "item";

export async function saveItem(_: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireStaff(rolesFor("menu"));
  const p = Item.safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: "invalid" };
  const { id, is_meal, active, ...rest } = p.data;
  const row = { ...rest, is_meal: !!is_meal, active: !!active };
  const db = await staffDb();
  const { data, error } = id
    ? await db.from("menu_items").update(row).eq("id", id).select("id")
    : await db.from("menu_items").insert({ ...row, slug: `${slugify(row.name_en)}-${crypto.randomUUID().slice(0, 6)}` }).select("id");
  return done(error || !data?.length);
}

const Option = z.object({
  id: z.uuid().optional(),
  item_id: z.uuid(),
  kind: z.enum(["size", "sauce"]),
  name_ar: text(60).min(1),
  name_en: text(60).min(1),
  price_delta: z.coerce.number().int().min(0).max(100000),
  sort: z.coerce.number().int().min(0).max(999),
  active: on,
});

export async function saveOption(_: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireStaff(rolesFor("menu"));
  const p = Option.safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: "invalid" };
  const { id, active, ...rest } = p.data;
  const db = await staffDb();
  const row = { ...rest, active: !id || !!active };
  const { data, error } = id
    ? await db.from("item_options").update(row).eq("id", id).select("id")
    : await db.from("item_options").insert(row).select("id");
  return done(error || !data?.length);
}

const MAX_PHOTO = 2 * 1024 * 1024;
const TYPES = ["image/jpeg", "image/png", "image/webp"];

// Re-encode every upload (strips metadata and anything hidden in the file), resize for phones.
export async function uploadPhoto(_: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireStaff(rolesFor("menu"));
  const id = z.uuid().safeParse(fd.get("id"));
  const file = fd.get("photo");
  if (!id.success || !(file instanceof File) || file.size === 0 || file.size > MAX_PHOTO || !TYPES.includes(file.type)) return { error: "badPhoto" };
  let webp: Buffer;
  try {
    webp = await sharp(Buffer.from(await file.arrayBuffer()), { limitInputPixels: 40_000_000 })
      .rotate().resize(800, 800, { fit: "cover" }).webp({ quality: 80 }).toBuffer();
  } catch {
    return { error: "badPhoto" }; // not really an image
  }
  const db = await staffDb();
  const { data: item } = await db.from("menu_items").select("photo_url").eq("id", id.data).single();
  const path = `items/${id.data}-${crypto.randomUUID().slice(0, 8)}.webp`; // new name so phones don't show a cached old photo
  const { error } = await db.storage.from("menu-photos").upload(path, webp, { contentType: "image/webp" });
  if (error) return { error: "error" };
  const res = await db.from("menu_items").update({ photo_url: path }).eq("id", id.data).select("id");
  if (item?.photo_url) await db.storage.from("menu-photos").remove([item.photo_url]);
  return done(res.error || !res.data?.length);
}

export async function removePhoto(fd: FormData) {
  await requireStaff(rolesFor("menu"));
  const id = z.uuid().parse(fd.get("id"));
  const db = await staffDb();
  const { data: item } = await db.from("menu_items").select("photo_url").eq("id", id).single();
  await db.from("menu_items").update({ photo_url: null }).eq("id", id);
  if (item?.photo_url) await db.storage.from("menu-photos").remove([item.photo_url]);
  done(null);
}
