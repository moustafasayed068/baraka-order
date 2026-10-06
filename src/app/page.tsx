import Link from "next/link";
import { AppHead } from "@/components/AppHead";
import { getLang, publicDb, type Branch } from "@/lib/db";
import { dict, pick } from "@/lib/i18n";

export default async function Home() {
  const lang = await getLang();
  const t = dict[lang];
  const { data, error } = await publicDb().from("branches").select("slug, name_ar, name_en, city, address_ar, address_en, accepts_orders").order("sort");
  if (error) throw error;
  const branches = data as Branch[];
  return (
    <div className="shell">
      <AppHead lang={lang} />
      <main className="branches">
        <h1 className="display text-2xl">{t.home.title}</h1>
        {(["alexandria", "cairo"] as const).map((city) => (
          <section key={city} className="grid gap-2">
            <h2>{t.home[city]}</h2>
            {branches.filter((b) => b.city === city).map((b) => (
              <Link key={b.slug} href={`/b/${b.slug}`} className="branch-link">
                <span>
                  <b>{pick(b, lang)}</b>
                  <small>{lang === "ar" ? b.address_ar : b.address_en}</small>
                </span>
                <span aria-hidden="true" className="add">›</span>
              </Link>
            ))}
          </section>
        ))}
        <p className="text-center text-sm text-muted">{t.home.hotline}: <b className="num">16099</b></p>
      </main>
    </div>
  );
}
