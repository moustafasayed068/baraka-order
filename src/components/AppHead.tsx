import Link from "next/link";
import { dict, type Lang } from "@/lib/i18n";
import { LangToggle } from "./LangToggle";
import { MyOrders } from "./MyOrders";

export function AppHead({ lang, children, excludeOrder }: { lang: Lang; children?: React.ReactNode; excludeOrder?: string }) {
  const t = dict[lang];
  return (
    <header className="app-head">
      <div className="row">
        <Link href="/" className="wordmark">{t.brand}<span>{t.tagline}</span></Link>
        <LangToggle lang={lang} />
      </div>
      {children}
      <MyOrders label={t.home.myOrders} exclude={excludeOrder} />
    </header>
  );
}
