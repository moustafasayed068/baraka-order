import type { NextConfig } from "next";
import { networkInterfaces } from "node:os";

// Let phones on the same Wi-Fi load the dev server (http://<this PC's LAN IP>:3000).
const lanIps = Object.values(networkInterfaces()).flat().filter((n) => n?.family === "IPv4" && !n.internal).map((n) => n!.address);

const nextConfig: NextConfig = {
  poweredByHeader: false,
  allowedDevOrigins: lanIps,
};

export default nextConfig;
