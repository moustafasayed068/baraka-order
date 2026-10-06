import { rolesFor } from "@/lib/admin-nav";
import { requireStaff, type Role } from "@/lib/auth";
import { adminDb, getLang } from "@/lib/db";
import { dict, pick } from "@/lib/i18n";
import { removeStaff, resetStaff2fa } from "./actions";
import { AddStaffForm } from "./AddStaffForm";

export default async function StaffPage() {
  const me = await requireStaff(rolesFor("staff"));
  const lang = await getLang();
  const a = dict[lang].admin;
  const t = a.st;
  const db = adminDb(); // owner-only page: needs emails and 2FA status from the auth admin API
  const [{ data: staff }, { data: users }, { data: branches }] = await Promise.all([
    db.from("staff").select("user_id, role, branch_id, name").order("role"),
    db.auth.admin.listUsers({ perPage: 1000 }),
    db.from("branches").select("id, name_ar, name_en").order("sort"),
  ]);
  const user = (id: string) => users?.users.find((u) => u.id === id);
  // the user list doesn't carry 2FA factors; ask per staff member (a handful of people)
  const factors = await Promise.all((staff ?? []).map((s) => db.auth.admin.mfa.listFactors({ userId: s.user_id })));
  const verified = new Set((staff ?? []).filter((_, i) => factors[i].data?.factors.some((f) => f.status === "verified")).map((s) => s.user_id));
  const has2fa = (id: string) => verified.has(id);

  return (
    <>
      <section className="card">
        <h2>{t.add}</h2>
        <AddStaffForm lang={lang} branches={branches ?? []} />
      </section>
      <section className="card">
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>{t.name}</th><th>{t.email}</th><th>{t.role}</th><th>{t.branch}</th><th>{t.twoFa}</th><th /></tr></thead>
            <tbody>
              {staff?.map((s) => {
                const b = branches?.find((x) => x.id === s.branch_id);
                const twoFaRequired = s.role === "owner" || s.role === "manager";
                return (
                  <tr key={s.user_id}>
                    <td>{s.name}</td>
                    <td dir="ltr">{user(s.user_id)?.email}</td>
                    <td>{a.roles[s.role as Role]}</td>
                    <td>{b ? pick(b, lang) : a.allBranches}</td>
                    <td className={twoFaRequired && !has2fa(s.user_id) ? "text-red font-bold" : ""}>{has2fa(s.user_id) ? t.on : t.off}</td>
                    <td>
                      {s.user_id === me.userId ? <span className="text-muted">{t.you}</span> : (
                        <div className="flex flex-wrap gap-2">
                          {has2fa(s.user_id) && <form action={resetStaff2fa}><input type="hidden" name="id" value={s.user_id} /><button type="submit" className="chip">{t.reset2fa}</button></form>}
                          <form action={removeStaff}><input type="hidden" name="id" value={s.user_id} /><button type="submit" className="chip text-red!">{t.remove}</button></form>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
