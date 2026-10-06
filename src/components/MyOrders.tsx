"use client";
import Link from "next/link";
import { useSyncExternalStore } from "react";
import { readStorage, savedOrders } from "@/lib/client";

const noSubscribe = () => () => {};

// Orders placed on this device in the last 24 h, so tracking survives closing the browser.
export function MyOrders({ label, exclude }: { label: string; exclude?: string }) {
  const raw = useSyncExternalStore(noSubscribe, () => readStorage("bk_orders"), () => null);
  const orders = raw ? savedOrders().filter((o) => o.token !== exclude) : [];
  if (!orders.length) return null;
  return (
    <div className="my-orders">
      <span>{label}:</span>
      {orders.map((o) => (
        <Link key={o.token} href={`/t/${o.token}`} className="num">#{o.number}</Link>
      ))}
    </div>
  );
}
