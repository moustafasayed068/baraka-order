// STAGING ONLY. Creates (or reuses) a synthetic owner, signs in with password + TOTP (aal2) exactly like the
// admin login, and prints the resulting Cookie header for k6 (ADMIN_COOKIE).
// Usage: node loadtest/scripts/staff-session.mjs   (needs NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY)
import { createHmac } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL, anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, service = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!/^http:\/\/(127\.0\.0\.1|localhost)/.test(url) && process.env.ALLOW_REMOTE_STAGING !== "1") {
  console.error("Refusing: not a local Supabase. Set ALLOW_REMOTE_STAGING=1 only for a dedicated staging project.");
  process.exit(1);
}
const email = "loadtest-owner@staging.local", password = "Loadtest-" + "x".repeat(16);

function totp(secret, now = Date.now()) {
  const abc = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of secret.replace(/=+$/, "").toUpperCase()) bits += abc.indexOf(c).toString(2).padStart(5, "0");
  const key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
  const ctr = Buffer.alloc(8); ctr.writeBigUInt64BE(BigInt(Math.floor(now / 30000)));
  const h = createHmac("sha1", key).update(ctr).digest(), o = h[h.length - 1] & 0xf;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, "0");
}

const admin = createClient(url, service, { auth: { persistSession: false } });
// fresh user each time: TOTP factors can't be re-read after enrolment
const { data: list } = await admin.auth.admin.listUsers();
const old = list.users.find((u) => u.email === email);
if (old) await admin.auth.admin.deleteUser(old.id);
const { data: created, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
if (error) throw error;
await admin.from("staff").insert({ user_id: created.user.id, role: "owner", name: "Load test owner" }).throwOnError();

const jar = new Map();
const sb = createServerClient(url, anon, { cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: (l) => l.forEach((c) => jar.set(c.name, c.value)) } });
const { error: e1 } = await sb.auth.signInWithPassword({ email, password });
if (e1) throw e1;
const { data: f, error: e2 } = await sb.auth.mfa.enroll({ factorType: "totp" });
if (e2) throw e2;
const { error: e3 } = await sb.auth.mfa.challengeAndVerify({ factorId: f.id, code: totp(f.totp.secret) });
if (e3) throw e3;
process.stdout.write([...jar].map(([n, v]) => `${n}=${v}`).join("; "));
