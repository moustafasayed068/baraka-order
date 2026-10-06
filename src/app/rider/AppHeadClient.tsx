import { LangToggle } from "@/components/LangToggle";
import { dict, type Lang } from "@/lib/i18n";

// Brand header for staff phone pages (no customer "my orders" links).
export function AppHeadClient({ lang, children }: { lang: Lang; children?: React.ReactNode }) {
  const t = dict[lang];
  return (
    <header className="app-head">
      <div className="row">
        <div className="wordmark">{t.brand}<span>{t.rider.title}</span></div>
        <LangToggle lang={lang} />
      </div>
      {children}
    </header>
  );
}
