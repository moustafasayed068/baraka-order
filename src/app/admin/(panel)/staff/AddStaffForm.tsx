"use client";
import { useActionState, useState } from "react";
import { dict, pick, type Lang } from "@/lib/i18n";
import { addStaff } from "./actions";

export function AddStaffForm({ lang, branches }: { lang: Lang; branches: { id: string; name_ar: string; name_en: string }[] }) {
  const a = dict[lang].admin;
  const t = a.st;
  const [state, run, pending] = useActionState(addStaff, null);
  const [role, setRole] = useState("manager");
  return (
    <form action={run} className="grid-form">
      <div className="field"><label htmlFor="s-name">{t.name}</label><input id="s-name" name="name" required maxLength={60} /></div>
      <div className="field"><label htmlFor="s-email">{t.email}</label><input id="s-email" name="email" type="email" dir="ltr" required /></div>
      <div className="field">
        <label htmlFor="s-role">{t.role}</label>
        <select id="s-role" name="role" className="select" value={role} onChange={(e) => setRole(e.target.value)}>
          {(["manager", "cashier", "callcentre", "owner"] as const).map((r) => <option key={r} value={r}>{a.roles[r]}</option>)}
        </select>
      </div>
      {role !== "owner" && (
        <div className="field">
          <label htmlFor="s-branch">{t.branch}</label>
          <select id="s-branch" name="branch_id" className="select">{branches.map((b) => <option key={b.id} value={b.id}>{pick(b, lang)}</option>)}</select>
        </div>
      )}
      <button type="submit" className="btn w-auto! px-6!" disabled={pending}>{t.add}</button>
      {state?.password && <p className="ok-note col-span-full" role="status">{t.created(state.password)}</p>}
      {state?.error && <p className="err col-span-full" role="alert">{state.error === "emailTaken" ? t.emailTaken : a.error}</p>}
    </form>
  );
}
