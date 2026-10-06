import { NextResponse, type NextRequest } from "next/server";

// Security headers + per-request CSP nonce for every page.
export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const dev = process.env.NODE_ENV === "development";
  const supabase = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
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
