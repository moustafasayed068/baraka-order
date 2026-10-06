import { redirect } from "next/navigation";
import { getStaff, staffDb } from "@/lib/auth";
import { getLang } from "@/lib/db";
import { MfaForm } from "./MfaForm";

export const metadata = { title: "التحقق بخطوتين | El Baraka" };

// Owner/manager 2FA: first visit enrolls an authenticator app, later visits ask for the code.
export default async function MfaPage() {
  const staff = await getStaff();
  if (!staff) redirect("/admin/login");
  if (staff.aal2) redirect("/admin");
  const db = await staffDb();
  const { data } = await db.auth.mfa.listFactors();
  const verified = data?.totp.find((f) => f.status === "verified");
  if (verified) return <MfaForm lang={await getLang()} factorId={verified.id} />;

  // drop half-finished enrollments from earlier visits, then start a fresh one
  for (const f of data?.all ?? []) if (f.factor_type === "totp" && f.status !== "verified") await db.auth.mfa.unenroll({ factorId: f.id });
  const { data: enroll, error } = await db.auth.mfa.enroll({ factorType: "totp", friendlyName: "El Baraka" });
  if (error) throw error;
  return <MfaForm lang={await getLang()} factorId={enroll.id} qr={enroll.totp.qr_code} secret={enroll.totp.secret} />;
}
