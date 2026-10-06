import Link from "next/link";
import { AppHead } from "@/components/AppHead";
import { GpsBranch } from "@/components/GpsBranch";
import { getLang, publicDb, type Branch } from "@/lib/db";
import { dict, pick } from "@/lib/i18n";

type Z = { branch_id: string; fee: number; min_order: number; max_km: number };

export default async function Home({ searchParams }: PageProps<"/">) {
  const delivery = (await searchParams).mode === "delivery";
  const lang = await getLang();
  const t = dict[lang];
  const db = publicDb();
  const [{ data, error }, zonesRes] = await Promise.all([
    db.from("branches").select("id, slug, name_ar, name_en, city, address_ar, address_en, accepts_orders, accepts_delivery, lat, lng").order("sort"),
    delivery ? db.from("delivery_zones").select("branch_id, fee, min_order, max_km").eq("active", true).order("fee") : null,
  ]);
  if (error) throw error;
  const zones = (zonesRes?.data ?? []) as Z[];
  const zoneOf = (id: string) => zones.find((z) => z.branch_id === id); // cheapest delivery setting
  const shown = (data as Branch[]).filter((b) => !delivery || (b.accepts_orders && b.accepts_delivery && zoneOf(b.id)));
  const href = (slug: string) => (delivery ? `/b/${slug}?mode=delivery` : `/b/${slug}`);

  return (
    <div className="shell">
      <AppHead lang={lang} />
      <main className="branches">
        <div className="seg" role="group">
          <Link href="/" aria-current={!delivery} className={`grid place-items-center min-h-11 rounded-[10px] font-bold ${!delivery ? "bg-red text-white" : ""}`}>{t.delivery.pickup}</Link>
          <Link href="/?mode=delivery" aria-current={delivery} className={`grid place-items-center min-h-11 rounded-[10px] font-bold ${delivery ? "bg-red text-white" : ""}`}>{t.delivery.delivery}</Link>
        </div>
        <h1 className="display text-2xl">{delivery ? t.delivery.homeTitle : t.home.title}</h1>

        {delivery && (
          <>
            <GpsBranch lang={lang} branches={shown.map((b) => ({ slug: b.slug, lat: b.lat, lng: b.lng, maxKm: Math.max(...zones.filter((z) => z.branch_id === b.id).map((z) => Number(z.max_km))) }))} />
            <p className="text-sm text-muted">{t.delivery.orPickBranch}</p>
          </>
        )}

        {(["alexandria", "cairo"] as const).map((city) => (
          <section key={city} className="grid gap-2">
            <h2>{t.home[city]}</h2>
            {shown.filter((b) => b.city === city).map((b) => {
              const z = zoneOf(b.id);
              return (
                <Link key={b.slug} href={href(b.slug)} className="branch-link">
                  <span>
                    <b>{pick(b, lang)}</b>
                    <small className="num">
                      {lang === "ar" ? b.address_ar : b.address_en}
                      {z && ` · ${t.delivery.fee} ${z.fee} ${t.egp} · ${t.delivery.minOrder(z.min_order)}`}
                    </small>
                  </span>
                  <span aria-hidden="true" className="add">›</span>
                </Link>
              );
            })}
          </section>
        ))}
        <p className="text-center text-sm text-muted">{t.home.hotline}: <b className="num">16099</b></p>
      </main>
    </div>
  );
}
