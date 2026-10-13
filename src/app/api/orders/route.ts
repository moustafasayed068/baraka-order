import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { sameOrigin } from "@/lib/db";
import { OrderInput, placeOrder } from "@/lib/orders";

// Customer checkout only: the anti-bot fields below; everything else lives in placeOrder (shared with the call centre).
const BotCheck = z.object({
  website: z.string().max(0), // honeypot: real people never see this field
  fillMs: z.number().min(1500), // basic bot check: nobody fills a checkout in under 1.5 s
});

export async function POST(req: NextRequest) {
  // CSRF: only accept requests from our own pages
  if (!sameOrigin(req)) return NextResponse.json({ error: "invalid" }, { status: 403 });
  const raw = await req.json().catch(() => null);
  const parsed = OrderInput.safeParse(raw);
  if (!parsed.success || !BotCheck.safeParse(raw).success) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || null;
  const r = await placeOrder(parsed.data, { ip });
  if (!r.ok) return NextResponse.json({ error: r.error, ...r.extra }, { status: r.status });
  return NextResponse.json({ token: r.token, number: r.number, pay: parsed.data.paymentMethod === "online" }, { status: r.created ? 201 : 200 });
}
