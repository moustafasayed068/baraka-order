import Link from "next/link";
import { notFound } from "next/navigation";
import { AppHead } from "@/components/AppHead";
import { activeOrderCount, DELIVERY_TRAVEL_MIN, estimateMin, getBranch, getLang, publicDb } from "@/lib/db";
import { fmtTime, isOpenAt } from "@/lib/hours";
import { dict, pick } from "@/lib/i18n";
import { Menu, type MenuItem, type Zone } from "./Menu";

export default async function BranchPage({ params, searchParams }: PageProps<"/b/[branch]">) {
  const [{ branch: slug }, { zone }] = await Promise.all([params, searchParams]);
  const [lang, branch] = await Promise.all([getLang(), getBranch(slug)]);
  if (!branch) notFound();
  const t = dict[lang];
  const db = publicDb();
  const [cats, items, soldOut, active, zones] = await Promise.all([
    db.from("categories").select("id, slug, name_ar, name_en").order("sort"),
    db.from("menu_items")
      .select("id, slug, category_id, name_ar, name_en, desc_ar, desc_en, base_price, photo_url, is_meal, options:item_options(id, kind, name_ar, name_en, price_delta, sort)")
      .eq("active", true).order("sort"),
    db.from("branch_item_status").select("item_id").eq("branch_id", branch.id).eq("sold_out", true),
    activeOrderCount(branch.id),
    db.from("delivery_zones").select("id, name_ar, name_en, fee, min_order").eq("branch_id", branch.id).eq("active", true).order("fee"),
  ]);
  if (cats.error || items.error) throw cats.error ?? items.error;
  const out = new Set(soldOut.data?.map((s) => s.item_id));
  const menu = (items.data as Omit<MenuItem, "sold_out">[]).map((i) => ({
    ...i,
    options: [...i.options].sort((a, b) => a.sort - b.sort),
    sold_out: out.has(i.id),
  }));
  const wait = estimateMin(active, branch.extra_wait_min);
  const open = isOpenAt(branch.opens_at, branch.closes_at);
  const blocked = !branch.accepts_orders ? t.menu.paused : !open ? t.menu.closed(fmtTime(branch.opens_at, lang), fmtTime(branch.closes_at, lang)) : null;

  return (
    <div className="shell">
      <AppHead lang={lang}>
        <div className="load">
          <span>{t.track.branch}: <b>{pick(branch, lang)}</b></span>
          <Link href="/" className="underline">{t.menu.changeBranch}</Link>
        </div>
        <div className="load">
          <span>{t.menu.kitchenNow}: <b className="num">{t.menu.ordersInQ(active)}</b></span>
          <span className="num">{t.menu.wait(wait)}</span>
        </div>
      </AppHead>
      {blocked && <p className="banner" role="status">{blocked}</p>}
      <Menu lang={lang} branch={branch.slug} categories={cats.data} items={menu} blocked={!!blocked}
        zones={(zones.data ?? []) as Zone[]} acceptsDelivery={branch.accepts_delivery} deliveryEta={wait + DELIVERY_TRAVEL_MIN}
        initialZone={typeof zone === "string" ? zone : null} />
    </div>
  );
}
