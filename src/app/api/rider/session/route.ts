import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { adminDb, getRider, sameOrigin } from "@/lib/db";
import { PHONE_RE } from "@/lib/phone";

const Login = z.object({ phone: z.string().regex(PHONE_RE), pin: z.string().regex(/^[0-9]{4,8}$/) });

// Rider login: phone + PIN, one shift (16 h).
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const b = Login.safeParse(await req.json().catch(() => null));
  if (!b.success) return NextResponse.json({ error: "bad_login" }, { status: 400 });
  const { data, error } = await adminDb().rpc("rider_login", { p_phone: b.data.phone, p_pin: b.data.pin });
  if (error || !data?.[0]) return NextResponse.json({ error: "server" }, { status: 500 });
  const { token, error: err } = data[0];
  if (!token) return NextResponse.json({ error: err }, { status: err === "locked" ? 429 : 401 });
  const res = NextResponse.json({ ok: true });
  res.cookies.set("bk_rider", token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 16 * 3600 });
  return res;
}

export async function DELETE(req: NextRequest) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const rider = await getRider();
  if (rider) await adminDb().from("rider_sessions").update({ revoked_at: new Date().toISOString() }).eq("id", rider.sessionId);
  const res = NextResponse.json({ ok: true });
  res.cookies.delete("bk_rider");
  return res;
}
