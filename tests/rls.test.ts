// RLS tests against the local Supabase (npm run db:start && npm run db:reset first).
// Logs in as each role and checks what it can and cannot read/write.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const anon = createClient(url, anonKey, { auth: { persistSession: false } });

const PASSWORD = "Test-password-1234";
const users: string[] = [];
let bahary: string, smouha: string, water: string;
let baharyOrder: string, smouhaOrder: string;
let owner: SupabaseClient, manager: SupabaseClient;

async function staffClient(role: "owner" | "manager", branchId: string | null) {
  const email = `${role}-${randomUUID()}@test.local`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error) throw error;
  users.push(data.user.id);
  await admin.from("staff").insert({ user_id: data.user.id, role, branch_id: branchId, name: role }).throwOnError();
  const c = createClient(url, anonKey, { auth: { persistSession: false } });
  await c.auth.signInWithPassword({ email, password: PASSWORD });
  return c;
}

async function order(branchId: string) {
  const { data } = await admin.rpc("create_order", {
    p_order: { branch_id: branchId, idempotency_key: randomUUID(), type: "pickup", customer_name: "Test", customer_phone: "01000000000",
      subtotal: 10, delivery_fee: 0, total: 10, pickup_in_min: 0 },
    p_items: [{ item_id: water, option_id: null, name_ar: "مياه", name_en: "Water", unit_price: 10, qty: 1 }],
  }).throwOnError();
  const { data: o } = await admin.from("orders").select("id").eq("tracking_token", data![0].tracking_token).single().throwOnError();
  return o!.id as string;
}

beforeAll(async () => {
  const { data: b } = await admin.from("branches").select("id, slug").in("slug", ["bahary", "smouha"]).throwOnError();
  bahary = b!.find((x) => x.slug === "bahary")!.id;
  smouha = b!.find((x) => x.slug === "smouha")!.id;
  water = (await admin.from("menu_items").select("id").eq("slug", "x-water").single().throwOnError()).data!.id;
  baharyOrder = await order(bahary);
  smouhaOrder = await order(smouha);
  owner = await staffClient("owner", null);
  manager = await staffClient("manager", bahary);
});

afterAll(async () => {
  await admin.from("orders").delete().in("id", [baharyOrder, smouhaOrder]);
  await admin.from("customers").delete().eq("phone", "01000000000");
  for (const id of users) await admin.auth.admin.deleteUser(id);
});

describe("anonymous customer", () => {
  it("reads the public menu and branches", async () => {
    expect((await anon.from("branches").select("id")).data!.length).toBeGreaterThanOrEqual(10);
    expect((await anon.from("menu_items").select("id")).data!.length).toBeGreaterThan(0);
    expect((await anon.from("delivery_zones").select("id")).data!.length).toBeGreaterThan(0);
  });
  it("cannot read orders, items, customers, staff or audit", async () => {
    for (const t of ["orders", "order_items", "customers", "addresses", "staff", "audit_log", "order_counters", "branch_pins", "devices", "rider_sessions"]) {
      const { data } = await anon.from(t).select("*");
      expect(data ?? [], t).toEqual([]);
    }
    expect((await anon.from("riders").select("pin_hash")).error).not.toBeNull();
  });
  it("cannot create orders or change prices", async () => {
    expect((await anon.from("orders").insert({ branch_id: bahary })).error).not.toBeNull();
    expect((await anon.rpc("create_order", { p_order: {}, p_items: [] })).error).not.toBeNull();
    expect((await anon.rpc("next_order_number", { p_branch: bahary })).error).not.toBeNull();
    expect((await anon.rpc("pair_device", { p_slug: "bahary", p_pin: "1234", p_kind: "kitchen" })).error).not.toBeNull();
    expect((await anon.rpc("rider_login", { p_phone: "01000000101", p_pin: "1234" })).error).not.toBeNull();
    const { data } = await anon.from("menu_items").update({ base_price: 1 }).eq("id", water).select();
    expect(data ?? []).toEqual([]);
  });
});

describe("branch manager", () => {
  it("reads own branch orders only", async () => {
    const { data } = await manager.from("orders").select("id").in("id", [baharyOrder, smouhaOrder]);
    expect(data!.map((o) => o.id)).toEqual([baharyOrder]);
  });
  it("updates status but never money fields", async () => {
    expect((await manager.from("orders").update({ status: "preparing" }).eq("id", baharyOrder).select()).data).toHaveLength(1);
    expect((await manager.from("orders").update({ total: 1, subtotal: 1 }).eq("id", baharyOrder)).error).not.toBeNull();
    expect((await manager.from("orders").update({ payment_status: "paid" }).eq("id", baharyOrder)).error).not.toBeNull();
    expect((await manager.from("orders").update({ status: "cancelled" }).eq("id", smouhaOrder).select()).data).toEqual([]);
  });
  it("cannot edit the chain menu or read the audit log", async () => {
    expect((await manager.from("menu_items").update({ base_price: 1 }).eq("id", water).select()).data).toEqual([]);
    expect((await manager.from("audit_log").select("*")).data).toEqual([]);
  });
});

describe("owner", () => {
  it("reads every branch's orders", async () => {
    expect((await owner.from("orders").select("id").in("id", [baharyOrder, smouhaOrder])).data).toHaveLength(2);
  });
  it("edits menu prices", async () => {
    expect((await owner.from("menu_items").update({ base_price: 11 }).eq("id", water).select()).data).toHaveLength(1);
    await owner.from("menu_items").update({ base_price: 10 }).eq("id", water);
  });
});

describe("order numbers", () => {
  it("are unique per branch per day under concurrency", async () => {
    const ids = await Promise.all(Array.from({ length: 10 }, () => order(bahary)));
    const { data } = await admin.from("orders").select("number").in("id", ids);
    expect(new Set(data!.map((o) => o.number)).size).toBe(10);
    await admin.from("orders").delete().in("id", ids);
  });
});
