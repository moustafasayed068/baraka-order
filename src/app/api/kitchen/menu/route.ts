import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { adminDb, getDevice, sameOrigin } from "@/lib/db";

export async function GET() {
  const device = await getDevice("kitchen");
  if (!device) return NextResponse.json({ error: "unpaired" }, { status: 401 });
  const db = adminDb();
  const [items, out] = await Promise.all([
    db.from("menu_items").select("id, name_ar, name_en, categories(sort), sort").eq("active", true),
    db.from("branch_item_status").select("item_id").eq("branch_id", device.branch.id).eq("sold_out", true),
  ]);
  if (items.error) return NextResponse.json({ error: "server" }, { status: 500 });
  const soldOut = new Set(out.data?.map((s) => s.item_id));
  const rows = items.data
    .map((i) => ({ id: i.id, name_ar: i.name_ar, name_en: i.name_en, sold_out: soldOut.has(i.id), k: (i.categories as unknown as { sort: number }).sort * 1000 + i.sort }))
    .sort((a, b) => a.k - b.k);
  return NextResponse.json(rows, { headers: { "Cache-Control": "no-store" } });
}

const Body = z.object({ itemId: z.uuid(), soldOut: z.boolean() });

// Toggle "sold out" for this branch only.
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const device = await getDevice("kitchen");
  if (!device) return NextResponse.json({ error: "unpaired" }, { status: 401 });
  const b = Body.safeParse(await req.json().catch(() => null));
  if (!b.success) return NextResponse.json({ error: "invalid" }, { status: 400 });
  const { error } = await adminDb().from("branch_item_status")
    .upsert({ branch_id: device.branch.id, item_id: b.data.itemId, sold_out: b.data.soldOut });
  return error ? NextResponse.json({ error: "server" }, { status: 500 }) : NextResponse.json({ ok: true });
}
