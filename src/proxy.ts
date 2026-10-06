import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { authCookie } from "@/lib/auth";

// Security headers + per-request CSP nonce for every page; refreshes the staff session on /admin.
export async function proxy(request: NextRequest) {
  // Staff session refresh (server components can't write cookies, so it happens here).
  const refreshed: { name: string; value: string; options: object }[] = [];
  if (request.nextUrl.pathname.startsWith("/admin")) {
    const sb = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (list) => list.forEach((c) => { request.cookies.set(c.name, c.value); refreshed.push(c); }),
      },
    });
    await sb.auth.getUser();
  }

  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const dev = process.env.NODE_ENV === "development";
  const env = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  // same rule as devHost() in lib/client: a local Supabase is reached via the host the page was opened on
  const local = new URL(env || "http://x").hostname;
  const pageHost = (request.headers.get("host") ?? "localhost").replace(/:\d+$/, "");
  const supabase = local === "127.0.0.1" || local === "localhost" ? env.replace(local, pageHost) : env;
  const ws = supabase.replace(/^http/, "ws");
  const customerPage = !/^\/(kitchen|screen|rider|admin)/.test(request.nextUrl.pathname);
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' blob: data: ${supabase}`,
    "font-src 'self'",
    `connect-src 'self' ${supabase} ${ws}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    dev ? "" : "upgrade-insecure-requests", // dev is served over plain http to phones on the LAN
  ].filter(Boolean).join("; ");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  const res = NextResponse.next({ request: { headers: requestHeaders } });
  refreshed.forEach((c) => res.cookies.set(c.name, c.value, { ...c.options, ...authCookie }));
  res.headers.set("Content-Security-Policy", csp);
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.headers.set("X-Frame-Options", "DENY");
  res.headers.set("Permissions-Policy", `camera=(), microphone=(), payment=(), geolocation=(${customerPage ? "self" : ""})`);
  if (!dev) res.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
  return res;
}

export const config = {
  matcher: [{ source: "/((?!_next/static|_next/image|favicon.ico).*)", missing: [{ type: "header", key: "next-router-prefetch" }] }],
};
