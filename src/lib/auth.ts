import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export type Role = "owner" | "manager" | "kitchen" | "cashier" | "callcentre";

// Staff session cookies are HttpOnly: all admin work happens on the server, browsers never read the session.
export const authCookie = { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/" };

// Supabase client acting AS the signed-in staff member, so every query goes through RLS.
export async function staffDb() {
  const jar = await cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => jar.getAll(),
      setAll: (list) => {
        try {
          list.forEach(({ name, value, options }) => jar.set(name, value, { ...options, ...authCookie }));
        } catch {} // server components can't set cookies; the proxy refreshes the session instead
      },
    },
  });
}

export type Staff = { userId: string; email: string; role: Role; branchId: string | null; name: string; aal2: boolean; hasFactor: boolean };

export async function getStaff(): Promise<Staff | null> {
  const db = await staffDb();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return null;
  const [{ data: row }, { data: aal }] = await Promise.all([
    db.from("staff").select("role, branch_id, name").eq("user_id", user.id).maybeSingle(),
    db.auth.mfa.getAuthenticatorAssuranceLevel(),
  ]);
  if (!row) return null;
  return {
    userId: user.id, email: user.email ?? "", role: row.role, branchId: row.branch_id, name: row.name,
    aal2: aal?.currentLevel === "aal2", hasFactor: aal?.nextLevel === "aal2",
  };
}

export const needs2fa = (s: Staff) => (s.role === "owner" || s.role === "manager") && !s.aal2;

// Page/action guard: signed in, 2FA done where required, and one of the allowed roles.
export async function requireStaff(roles: Role[]): Promise<Staff> {
  const s = await getStaff();
  if (!s) redirect("/admin/login");
  if (needs2fa(s)) redirect("/admin/mfa");
  if (!roles.includes(s.role)) redirect("/admin");
  return s;
}
