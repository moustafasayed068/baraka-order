// Emergency 2FA reset for one staff login (e.g. the owner lost their phone).
// Removes their authenticator; at the next sign-in they scan a new QR code.
// Usage: node --env-file=.env.local scripts/reset-2fa.mjs <email>
import { createClient } from "@supabase/supabase-js";

const email = process.argv[2];
if (!email) { console.error("usage: reset-2fa.mjs <email>"); process.exit(1); }
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data } = await db.auth.admin.listUsers({ perPage: 1000 });
const user = data?.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
if (!user) { console.error(`no login for ${email}`); process.exit(1); }
const { data: f } = await db.auth.admin.mfa.listFactors({ userId: user.id });
for (const factor of f?.factors ?? []) await db.auth.admin.mfa.deleteFactor({ userId: user.id, id: factor.id });
await db.from("audit_log").insert({ action: "staff_2fa_reset", entity: "staff", entity_id: user.id, after: { by: "script" } });
console.log(`2FA reset for ${email} (${f?.factors.length ?? 0} removed). They will scan a new QR code at the next sign-in.`);
