"use client";
import { useEffect } from "react";

// Production only: in development a service worker would serve stale code over hot reload.
export function RegisterSW() {
  useEffect(() => {
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
    }
  }, []);
  return null;
}
