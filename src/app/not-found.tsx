import Link from "next/link";
import { getLang } from "@/lib/db";
import { dict } from "@/lib/i18n";

export default async function NotFound() {
  const t = dict[await getLang()];
  return (
    <main className="shell items-center justify-center gap-4 p-6 text-center">
      <div className="display text-7xl text-red">404</div>
      <p className="text-lg font-semibold">{t.notFound}</p>
      <Link href="/" className="btn max-w-60">{t.goHome}</Link>
    </main>
  );
}
