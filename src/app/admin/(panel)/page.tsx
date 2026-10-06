import { redirect } from "next/navigation";
import { getStaff } from "@/lib/auth";
import { getLang } from "@/lib/db";
import { dict } from "@/lib/i18n";

// Overview / dashboard (filled in by part 5). Cashier and call-centre staff go straight to their page.
export default async function AdminHome() {
  const staff = (await getStaff())!;
  if (staff.role === "cashier") redirect("/admin/orders");
  if (staff.role === "callcentre") redirect("/admin/call");
  const t = dict[await getLang()].admin;
  return <h1 className="display text-3xl">{t.nav.dashboard}</h1>;
}
