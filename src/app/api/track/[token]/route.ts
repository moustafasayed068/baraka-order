import { NextResponse } from "next/server";
import { getTracking } from "@/lib/db";

export async function GET(_req: Request, ctx: RouteContext<"/api/track/[token]">) {
  const t = await getTracking((await ctx.params).token);
  return t ? NextResponse.json(t, { headers: { "Cache-Control": "no-store" } }) : NextResponse.json({ error: "not_found" }, { status: 404 });
}
