import { rolesFor } from "@/lib/admin-nav";
import { requireStaff } from "@/lib/auth";
import { getLang, publicDb } from "@/lib/db";
import { CallForm, type CallItem } from "./CallForm";

export default async function CallPage() {
  const staff = await requireStaff(rolesFor("callcentre"));
  const lang = await getLang();
  const db = publicDb(); // same public menu the customer sees (active items only)
  const anyBranch = staff.role === "owner" || staff.role === "callcentre";
  let bq = db.from("branches").select("id, slug, name_ar, name_en").eq("accepts_orders", true).order("sort");
  if (!anyBranch) bq = bq.eq("id", staff.branchId!);
  const [{ data: branches }, { data: cats }, { data: items, error }] = await Promise.all([
    bq,
    db.from("categories").select("id, name_ar, name_en").order("sort"),
    db.from("menu_items").select("id, category_id, name_ar, name_en, base_price, options:item_options(id, name_ar, name_en, price_delta, sort)").eq("active", true).order("sort"),
  ]);
  if (error) throw error;
  const sorted = (items as CallItem[]).map((i) => ({ ...i, options: [...i.options].sort((a, b) => a.sort - b.sort) }));
  return <CallForm lang={lang} branches={branches ?? []} categories={cats ?? []} items={sorted} />;
}
