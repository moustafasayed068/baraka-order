import type { NextConfig } from "next";
import { networkInterfaces } from "node:os";

// Let phones on the same Wi-Fi load the dev server (http://<this PC's LAN IP>:3000).
const lanIps = Object.values(networkInterfaces()).flat().filter((n) => n?.family === "IPv4" && !n.internal).map((n) => n!.address);

const nextConfig: NextConfig = {
  poweredByHeader: false,
  allowedDevOrigins: lanIps,
  // menu photo uploads (max 2 MB, checked again in the action)
  experimental: { serverActions: { bodySizeLimit: "3mb" } },
  // service worker: never cached, so phones always pick up the latest version
  async headers() {
    return [{ source: "/sw.js", headers: [
      { key: "Content-Type", value: "application/javascript; charset=utf-8" },
      { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
      { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'" },
    ] }];
  },
};

export default nextConfig;
