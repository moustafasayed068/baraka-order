import Link from "next/link";
import { redirect } from "next/navigation";
import { LangToggle } from "@/components/LangToggle";
import { NAV } from "@/lib/admin-nav";
import { getStaff, needs2fa } from "@/lib/auth";
import { getLang } from "@/lib/db";
import { dict } from "@/lib/i18n";
import { signOut } from "../auth-actions";

export const metadata = { title: "الإدارة | El Baraka" };

export default async function PanelLayout({ children }: LayoutProps<"/admin">) {
  const [staff, lang] = await Promise.all([getStaff(), getLang()]);
  if (!staff) redirect("/admin/login");
  if (needs2fa(staff)) redirect("/admin/mfa");
  if (staff.role === "kitchen") redirect("/kitchen");
  const t = dict[lang].admin;
  return (
    <div className="admin">
      <header className="admin-bar">
        <div className="flex items-center justify-between gap-2">
          <div className="wordmark text-3xl!">{dict[lang].brand}<span>{t.title} · {staff.name} · {t.roles[staff.role]}</span></div>
          <div className="flex gap-2">
            <LangToggle lang={lang} />
            <form action={signOut}><button type="submit" className="pill">{t.signOut}</button></form>
          </div>
        </div>
        <nav className="admin-nav">
          {NAV.filter((n) => (n.roles as readonly string[]).includes(staff.role)).map((n) => (
            <Link key={n.key} href={n.href}>{t.nav[n.key]}</Link>
          ))}
        </nav>
      </header>
      <div className="admin-body">{children}</div>
    </div>
  );
}
