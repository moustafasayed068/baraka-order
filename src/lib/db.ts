import "server-only";
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import type { Lang } from "./i18n";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;

// Anonymous client: same rights as a customer's browser (RLS applies).
export const publicDb = () =>
  createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });

// service_role bypasses RLS. Server routes only, after validating the request.
export const adminDb = () =>
  createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

export async function getLang(): Promise<Lang> {
  return (await cookies()).get("lang")?.value === "en" ? "en" : "ar";
}

export const ACTIVE_STATUSES = ["received", "preparing"] as const;

// ponytail: flat estimate, replace with measured average prep time per branch once orders exist
export const estimateMin = (ahead: number, extraWait: number) => 8 + 2 * ahead + extraWait;

export type Branch = {
  id: string; slug: string; name_ar: string; name_en: string; city: "alexandria" | "cairo";
  address_ar: string; address_en: string; opens_at: string; closes_at: string;
  accepts_orders: boolean; extra_wait_min: number;
};

export async function getBranch(slug: string) {
  const { data } = await publicDb()
    .from("branches")
    .select("id, slug, name_ar, name_en, city, address_ar, address_en, opens_at, closes_at, accepts_orders, extra_wait_min")
    .eq("slug", slug)
    .maybeSingle();
  return data as Branch | null;
}

// Orders waiting in the kitchen (status only; counted with service_role since customers can't read orders).
export async function activeOrderCount(branchId: string) {
  const { count } = await adminDb()
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("branch_id", branchId)
    .in("status", ACTIVE_STATUSES);
  return count ?? 0;
}

export type Tracking = {
  number: number; status: string; type: string; total: number; pickup_in_min: number; created_at: string;
  customer_name: string; ahead: number; eta: number;
  branch: { id: string; slug: string; name_ar: string; name_en: string; address_ar: string; address_en: string };
  items: { name_ar: string; name_en: string; option_ar: string | null; option_en: string | null; qty: number }[];
};

// The tracking token is the only key a customer has to their order.
export async function getTracking(token: string): Promise<Tracking | null> {
  if (!/^[0-9a-f]{32}$/.test(token)) return null;
  const db = adminDb();
  const { data: o } = await db
    .from("orders")
    .select("id, branch_id, number, status, type, total, pickup_in_min, created_at, customer_name, branches(id, slug, name_ar, name_en, address_ar, address_en, extra_wait_min), order_items(name_ar, name_en, option_ar, option_en, qty)")
    .eq("tracking_token", token)
    .maybeSingle();
  if (!o) return null;
  const branch = o.branches as unknown as Branch;
  let ahead = 0;
  if ((ACTIVE_STATUSES as readonly string[]).includes(o.status)) {
    const { count } = await db.from("orders").select("id", { count: "exact", head: true })
      .eq("branch_id", o.branch_id).in("status", ACTIVE_STATUSES).lt("created_at", o.created_at);
    ahead = count ?? 0;
  }
  return {
    number: o.number, status: o.status, type: o.type, total: o.total, pickup_in_min: o.pickup_in_min, created_at: o.created_at,
    customer_name: o.customer_name.split(" ")[0], ahead,
    eta: Math.max(estimateMin(ahead, branch.extra_wait_min), o.pickup_in_min),
    branch: { id: branch.id, slug: branch.slug, name_ar: branch.name_ar, name_en: branch.name_en, address_ar: branch.address_ar, address_en: branch.address_en },
    items: o.order_items,
  };
}

// CSRF guard for state-changing routes: only our own pages may call them.
export function sameOrigin(req: Request) {
  const origin = req.headers.get("origin");
  return !!origin && new URL(origin).host === req.headers.get("host");
}

export type DeviceKind = "kitchen" | "screen";
export type DeviceBranch = { id: string; slug: string; name_ar: string; name_en: string };

// Paired kitchen tablet / TV: token in an HttpOnly cookie, only its sha256 is stored.
export async function getDevice(kind: DeviceKind) {
  const token = (await cookies()).get(`bk_${kind}`)?.value;
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return null;
  const { data } = await adminDb()
    .from("devices")
    .select("id, branches(id, slug, name_ar, name_en)")
    .eq("token_hash", createHash("sha256").update(token).digest("hex"))
    .eq("kind", kind)
    .is("revoked_at", null)
    .maybeSingle();
  return data ? { id: data.id as string, branch: data.branches as unknown as DeviceBranch } : null;
}

export type KitchenOrder = {
  id: string; number: number; first_name: string; type: "pickup" | "delivery"; status: string; total: number;
  payment_status: string; pickup_in_min: number; created_at: string; ready_at: string | null; needs_call_confirm: boolean;
  items: { qty: number; name_ar: string; name_en: string; option_ar: string | null; option_en: string | null }[];
};

// Kitchen sees first names only, never phone numbers or addresses.
export async function kitchenOrders(branchId: string): Promise<KitchenOrder[]> {
  const { data, error } = await adminDb()
    .from("orders")
    .select("id, number, customer_name, type, status, total, payment_status, pickup_in_min, created_at, ready_at, needs_call_confirm, order_items(qty, name_ar, name_en, option_ar, option_en)")
    .eq("branch_id", branchId)
    .in("status", ["received", "preparing", "ready"])
    .order("created_at");
  if (error) throw error;
  return data.map(({ customer_name, order_items, ...o }) => ({ ...o, first_name: customer_name.split(" ")[0], items: order_items }));
}

// TV screen: pickup order numbers only.
export async function screenNumbers(branchId: string) {
  const { data, error } = await adminDb()
    .from("orders")
    .select("number, status")
    .eq("branch_id", branchId)
    .eq("type", "pickup")
    .in("status", ["received", "preparing", "ready"])
    .order("created_at");
  if (error) throw error;
  return {
    preparing: data.filter((o) => o.status !== "ready").map((o) => o.number as number),
    ready: data.filter((o) => o.status === "ready").map((o) => o.number as number),
  };
}

export async function branchList() {
  const { data } = await publicDb().from("branches").select("slug, name_ar, name_en").order("sort");
  return data ?? [];
}
