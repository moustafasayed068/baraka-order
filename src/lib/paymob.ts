import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

// Paymob (Egypt) Unified Checkout via the Intention API.
// Everything is driven by env vars; online payment switches on by itself once they are all set.
//   PAYMOB_SECRET_KEY        secret key (Dashboard → Settings → Account info)
//   PAYMOB_PUBLIC_KEY        public key (safe to put in the checkout URL)
//   PAYMOB_HMAC_SECRET       HMAC secret, used to verify webhooks
//   PAYMOB_INTEGRATION_IDS   comma-separated integration ids to offer (card, wallet, …)
//   APP_URL                  public https URL of this site, e.g. https://order.elbaraka.com
//   PAYMOB_BASE_URL          optional, defaults to https://accept.paymob.com
// TODO(go-live): confirm the endpoint, payload and HMAC field order against Paymob's current docs with the real account.

const env = () => ({
  secret: process.env.PAYMOB_SECRET_KEY ?? "",
  publicKey: process.env.PAYMOB_PUBLIC_KEY ?? "",
  hmac: process.env.PAYMOB_HMAC_SECRET ?? "",
  integrations: (process.env.PAYMOB_INTEGRATION_IDS ?? "").split(",").map((s) => s.trim()).filter(Boolean).map(Number),
  appUrl: (process.env.APP_URL ?? "").replace(/\/$/, ""),
  base: (process.env.PAYMOB_BASE_URL ?? "https://accept.paymob.com").replace(/\/$/, ""),
});

export function paymentsEnabled() {
  const e = env();
  return !!(e.secret && e.publicKey && e.hmac && e.integrations.length && e.appUrl.startsWith("https://"));
}

// Local preview only: PAYMOB_PREVIEW=1 in development shows the online option and the pay page without keys
// (the Pay button then reports that online payment isn't available). Never active in production builds.
export function onlinePayOffered() {
  return paymentsEnabled() || (process.env.NODE_ENV === "development" && process.env.PAYMOB_PREVIEW === "1");
}

export type CheckoutOrder = {
  id: string; token: string; number: number; total: number; customer_name: string; customer_phone: string;
  items: { name_en: string; qty: number; line_total: number }[]; delivery_fee: number;
};

// Creates a payment intention for the server-calculated total and returns the hosted checkout URL.
export async function createCheckout(o: CheckoutOrder): Promise<{ url: string; ref: string | null }> {
  const e = env();
  const [first, ...rest] = o.customer_name.trim().split(/\s+/);
  const items = o.items.map((i) => ({ name: i.name_en.slice(0, 50), amount: Math.round((i.line_total / i.qty) * 100), quantity: i.qty }));
  if (o.delivery_fee) items.push({ name: "Delivery", amount: o.delivery_fee * 100, quantity: 1 });
  const res = await fetch(`${e.base}/v1/intention/`, {
    method: "POST",
    headers: { Authorization: `Token ${e.secret}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      amount: o.total * 100, // piastres
      currency: "EGP",
      payment_methods: e.integrations,
      items,
      // Paymob requires billing data; we only collect name + phone, so the rest is "NA" by design (data minimisation)
      billing_data: {
        first_name: first || "Customer", last_name: rest.join(" ") || "-", phone_number: "+2" + o.customer_phone,
        email: "NA@NA.com", street: "NA", building: "NA", floor: "NA", apartment: "NA", city: "NA", country: "EG", state: "NA",
      },
      special_reference: o.id,
      notification_url: `${e.appUrl}/api/paymob/webhook`,
      redirection_url: `${e.appUrl}/t/${o.token}`,
    }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`paymob intention ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  if (!data.client_secret) throw new Error("paymob intention: no client_secret");
  const url = `${e.base}/unifiedcheckout/?publicKey=${encodeURIComponent(e.publicKey)}&clientSecret=${encodeURIComponent(data.client_secret)}`;
  return { url, ref: data.intention_order_id != null ? String(data.intention_order_id) : null };
}

// Transaction-processed callback: HMAC-SHA512 over these fields of `obj`, concatenated in this exact order.
export const HMAC_FIELDS = [
  "amount_cents", "created_at", "currency", "error_occured", "has_parent_transaction", "id", "integration_id",
  "is_3d_secure", "is_auth", "is_capture", "is_refunded", "is_standalone_payment", "is_voided", "order.id", "owner",
  "pending", "source_data.pan", "source_data.sub_type", "source_data.type", "success",
] as const;

const get = (obj: unknown, path: string): unknown => path.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), obj);

export function hmacFor(obj: unknown, secret: string) {
  const msg = HMAC_FIELDS.map((f) => { const v = get(obj, f); return v === undefined || v === null ? "" : String(v); }).join("");
  return createHmac("sha512", secret).update(msg).digest("hex");
}

export function verifyHmac(obj: unknown, received: string | null, secret = env().hmac) {
  if (!received || !secret) return false;
  const a = Buffer.from(hmacFor(obj, secret), "hex");
  const b = Buffer.from(received.toLowerCase(), "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
