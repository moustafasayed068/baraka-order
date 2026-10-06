import Link from "next/link";
import { AppHead } from "@/components/AppHead";
import { GpsZone } from "@/components/GpsZone";
import { getLang, publicDb, type Branch } from "@/lib/db";
import type { Pt } from "@/lib/geo";
import { dict, pick } from "@/lib/i18n";

type Z = { id: string; name_ar: string; name_en: string; fee: number; min_order: number; polygon: Pt[] | null; branch_id: string };

export default async function Home({ searchParams }: PageProps<"/">) {
  const delivery = (await searchParams).mode === "delivery";
  const lang = await getLang();
  const t = dict[lang];
  const db = publicDb();
  const [{ data, error }, zonesRes] = await Promise.all([
    db.from("branches").select("id, slug, name_ar, name_en, city, address_ar, address_en, accepts_orders, accepts_delivery").order("sort"),
    delivery ? db.from("delivery_zones").select("id, name_ar, name_en, fee, min_order, polygon, branch_id").eq("active", true).order("fee") : null,
  ]);
  if (error) throw error;
  const branches = data as Branch[];
  const live = branches.filter((b) => b.accepts_orders && (!delivery || b.accepts_delivery));
  const zones = ((zonesRes?.data ?? []) as Z[]).filter((z) => live.some((b) => b.id === z.branch_id));
  const slugOf = (id: string) => branches.find((b) => b.id === id)!.slug;

  return (
    <div className="shell">
      <AppHead lang={lang} />
      <main className="branches">
        <div className="seg" role="group">
          <Link href="/" aria-current={!delivery} className={`grid place-items-center min-h-11 rounded-[10px] font-bold ${!delivery ? "bg-red text-white" : ""}`}>{t.delivery.pickup}</Link>
          <Link href="/?mode=delivery" aria-current={delivery} className={`grid place-items-center min-h-11 rounded-[10px] font-bold ${delivery ? "bg-red text-white" : ""}`}>{t.delivery.delivery}</Link>
        </div>
        <h1 className="display text-2xl">{delivery ? t.delivery.homeTitle : t.home.title}</h1>

        {delivery && zones.some((z) => z.polygon) && (
          <GpsZone lang={lang} zones={zones.filter((z) => z.polygon).map((z) => ({ id: z.id, polygon: z.polygon, href: `/b/${slugOf(z.branch_id)}?zone=${z.id}` }))} />
        )}

        {(["alexandria", "cairo"] as const).map((city) => (
          <section key={city} className="grid gap-2">
            <h2>{t.home[city]}</h2>
            {(delivery ? live : branches).filter((b) => b.city === city).map((b) =>
              delivery ? (
                zones.filter((z) => z.branch_id === b.id).map((z) => (
                  <Link key={z.id} href={`/b/${b.slug}?zone=${z.id}`} className="branch-link">
                    <span>
                      <b>{pick(z, lang)}</b>
                      <small className="num">{pick(b, lang)} · {t.delivery.fee} {z.fee} {t.egp} · {t.delivery.minOrder(z.min_order)}</small>
                    </span>
                    <span aria-hidden="true" className="add">›</span>
                  </Link>
                ))
              ) : (
                <Link key={b.slug} href={`/b/${b.slug}`} className="branch-link">
                  <span>
                    <b>{pick(b, lang)}</b>
                    <small>{lang === "ar" ? b.address_ar : b.address_en}</small>
                  </span>
                  <span aria-hidden="true" className="add">›</span>
                </Link>
              ),
            )}
          </section>
        ))}
        <p className="text-center text-sm text-muted">{t.home.hotline}: <b className="num">16099</b></p>
      </main>
    </div>
  );
}
