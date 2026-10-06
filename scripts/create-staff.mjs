// Create a staff login (first owner at launch, or test accounts locally).
// Usage: node --env-file=.env.local scripts/create-staff.mjs <email> <owner|manager|kitchen|cashier|callcentre> [branch-slug] [name]
// Prints a random password once; the person changes nothing else until they sign in and set up 2FA.
import { randomBytes } from "node:crypto";
import { appendFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const [email, role, slug, name = email?.split("@")[0]] = process.argv.slice(2);
const ROLES = ["owner", "manager", "kitchen", "cashier", "callcentre"];
if (!email || !ROLES.includes(role) || (role !== "owner" && !slug)) {
  console.error("usage: create-staff.mjs <email> <role> [branch-slug] [name]  (branch required except for owner)");
  process.exit(1);
}
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
let branchId = null;
if (slug) {
  const { data } = await db.from("branches").select("id").eq("slug", slug).maybeSingle();
  if (!data) { console.error(`no branch "${slug}"`); process.exit(1); }
  branchId = data.id;
}
const password = randomBytes(12).toString("base64url");
const { data: u, error } = await db.auth.admin.createUser({ email, password, email_confirm: true });
if (error) { console.error(error.message); process.exit(1); }
const { error: e2 } = await db.from("staff").insert({ user_id: u.user.id, role, branch_id: branchId, name });
if (e2) { await db.auth.admin.deleteUser(u.user.id); console.error(e2.message); process.exit(1); }
const line = `${role}${slug ? ` (${slug})` : ""}: ${email} / ${password}`;
if (process.env.NEXT_PUBLIC_SUPABASE_URL.includes("127.0.0.1")) appendFileSync("dev-accounts.local.txt", line + "\n"); // local only, gitignored
console.log(`created ${line}`);
