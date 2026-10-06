"use client";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Local dev: Supabase runs on this PC, so a phone must reach it via the same host it opened the site on
// (the LAN IP can change after a reboot). Real deployments use the configured URL unchanged.
export function devHost(url: string, host: string) {
  const u = new URL(url);
  if (u.hostname === "127.0.0.1" || u.hostname === "localhost") u.hostname = host;
  return u.origin;
}

// Anonymous browser client, used only for realtime broadcast topics keyed by tracking token.
let sb: SupabaseClient | null = null;
export const browserDb = () =>
  (sb ??= createClient(devHost(process.env.NEXT_PUBLIC_SUPABASE_URL!, location.hostname), process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } }));

// crypto.randomUUID needs a secure context (fails over http://192.168.x.x on a phone); getRandomValues doesn't.
export function uuid() {
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// localStorage can throw (private mode, blocked storage): never let that break ordering.
export const store = {
  get<T>(k: string, d: T): T {
    try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : d; } catch { return d; }
  },
  set(k: string, v: unknown) {
    try { localStorage.setItem(k, JSON.stringify(v)); } catch {}
  },
};

export type SavedOrder = { token: string; number: number; branch: string; at: number };
export const savedOrders = () => store.get<SavedOrder[]>("bk_orders", []).filter((o) => Date.now() - o.at < 24 * 3600_000);
export function saveOrder(o: Omit<SavedOrder, "at"> & { at?: number }) {
  store.set("bk_orders", [...savedOrders().filter((x) => x.token !== o.token), { ...o, at: o.at ?? Date.now() }].slice(-5));
}

export const elapsed = (since: number) => Date.now() - since;

// Raw localStorage value as an external store (no setState-in-effect, no hydration mismatch).
export const readStorage = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
