import Link from "next/link";
import { notFound } from "next/navigation";
import { AppHead } from "@/components/AppHead";
import { activeOrderCount, estimateMin, getBranch, getLang, publicDb } from "@/lib/db";
import { fmtTime, isOpenAt } from "@/lib/hours";
import { dict, pick } from "@/lib/i18n";
import { Menu, type MenuItem } from "./Menu";

export default async function BranchPage({ params }: PageProps<"/b/[branch]">) {
  const { branch: slug } = await params;
  const [lang, branch] = await Promise.all([getLang(), getBranch(slug)]);
  if (!branch) notFound();
  const t = dict[lang];
  const db = publicDb();
  const [cats, items, soldOut, active] = await Promise.all([
    db.from("categories").select("id, slug, name_ar, name_en").order("sort"),
    db.from("menu_items")
      .select("id, slug, category_id, name_ar, name_en, desc_ar, desc_en, base_price, photo_url, is_meal, options:item_options(id, kind, name_ar, name_en, price_delta, sort)")
      .eq("active", true).order("sort"),
    db.from("branch_item_status").select("item_id").eq("branch_id", branch.id).eq("sold_out", true),
    activeOrderCount(branch.id),
  ]);
  if (cats.error || items.error) throw cats.error ?? items.error;
  const out = new Set(soldOut.data?.map((s) => s.item_id));
  const menu = (items.data as Omit<MenuItem, "sold_out">[]).map((i) => ({
    ...i,
    options: [...i.options].sort((a, b) => a.sort - b.sort),
    sold_out: out.has(i.id),
  }));
  const open = isOpenAt(branch.opens_at, branch.closes_at);
  const blocked = !branch.accepts_orders ? t.menu.paused : !open ? t.menu.closed(fmtTime(branch.opens_at, lang), fmtTime(branch.closes_at, lang)) : null;

  return (
    <div className="shell">
      <AppHead lang={lang}>
        <div className="load">
          <span>{t.menu.pickupAt}: <b>{pick(branch, lang)}</b></span>
          <Link href="/" className="underline">{t.menu.changeBranch}</Link>
        </div>
        <div className="load">
          <span>{t.menu.kitchenNow}: <b className="num">{t.menu.ordersInQ(active)}</b></span>
          <span className="num">{t.menu.wait(estimateMin(active, branch.extra_wait_min))}</span>
        </div>
      </AppHead>
      {blocked && <p className="banner" role="status">{blocked}</p>}
      <Menu lang={lang} branch={branch.slug} categories={cats.data} items={menu} blocked={!!blocked} />
    </div>
  );
}
