// Fails the build if a server secret ended up in browser bundles (.next/static).
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const SECRET_NAMES = ["SUPABASE_SERVICE_ROLE_KEY", "PAYMOB_SECRET", "PAYMOB_HMAC", "SMS_API_KEY"];
const values = SECRET_NAMES.map((n) => process.env[n]).filter((v) => v && v.length > 8);
const needles = [...SECRET_NAMES, ...values, "service_role"];

const files = readdirSync(".next/static", { recursive: true }).filter((f) => f.endsWith(".js")).map((f) => join(".next/static", f));
const leaks = files.flatMap((f) => {
  const src = readFileSync(f, "utf8");
  return needles.filter((n) => src.includes(n)).map((n) => `${f}: ${SECRET_NAMES.includes(n) || n === "service_role" ? n : "<secret value>"}`);
});
if (leaks.length) {
  console.error("Server secret found in client bundle:\n" + leaks.join("\n"));
  process.exit(1);
}
console.log(`check-secrets: ${files.length} client bundles clean`);
