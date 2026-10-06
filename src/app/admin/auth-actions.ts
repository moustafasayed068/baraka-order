"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getStaff, needs2fa, staffDb } from "@/lib/auth";
import { adminDb } from "@/lib/db";

export type FormState = { error?: string } | null;

const Login = z.object({ email: z.email().max(200), password: z.string().min(1).max(200) });

export async function signIn(_: FormState, fd: FormData): Promise<FormState> {
  const p = Login.safeParse({ email: fd.get("email"), password: fd.get("password") });
  if (!p.success) return { error: "badLogin" };
  const db = await staffDb();
  const { error } = await db.auth.signInWithPassword(p.data);
  if (error) return { error: "badLogin" };
  const staff = await getStaff();
  if (!staff) {
    await db.auth.signOut();
    return { error: "notStaff" };
  }
  await adminDb().from("audit_log").insert({ actor: staff.userId, action: "staff_login", entity: "staff", entity_id: staff.userId });
  redirect(needs2fa(staff) ? "/admin/mfa" : "/admin");
}

export async function verifyMfa(_: FormState, fd: FormData): Promise<FormState> {
  const code = String(fd.get("code") ?? "").replace(/\D/g, "");
  const db = await staffDb();
  const { data } = await db.auth.mfa.listFactors();
  const factor = data?.all.find((f) => f.factor_type === "totp" && f.id === fd.get("factorId"));
  if (!factor || code.length !== 6) return { error: "mfaBad" };
  const { error } = await db.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
  if (error) return { error: "mfaBad" };
  redirect("/admin");
}

export async function signOut() {
  await (await staffDb()).auth.signOut();
  redirect("/admin/login");
}
