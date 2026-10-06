import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { adminDb, getDevice, sameOrigin } from "@/lib/db";

const Kind = z.enum(["kitchen", "screen"]);
const Pair = z.object({ branch: z.string().regex(/^[a-z0-9-]{2,40}$/), pin: z.string().regex(/^[0-9]{4,8}$/), kind: Kind });

// Pair this device with a branch using the branch PIN.
// ponytail: PIN alone pairs until staff login exists (build step 6); then require a logged-in manager too.
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const p = Pair.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: "bad_pin" }, { status: 400 });
  const { data, error } = await adminDb().rpc("pair_device", { p_slug: p.data.branch, p_pin: p.data.pin, p_kind: p.data.kind });
  if (error || !data?.[0]) return NextResponse.json({ error: "server" }, { status: 500 });
  const { token, error: err } = data[0];
  if (!token) return NextResponse.json({ error: err }, { status: err === "locked" ? 429 : 401 });
  const res = NextResponse.json({ ok: true });
  res.cookies.set(`bk_${p.data.kind}`, token, {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 400 * 24 * 3600,
  });
  return res;
}

// Unpair: revoke this device's token.
export async function DELETE(req: NextRequest) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const kind = Kind.safeParse(req.nextUrl.searchParams.get("kind"));
  if (!kind.success) return NextResponse.json({ error: "invalid" }, { status: 400 });
  const device = await getDevice(kind.data);
  if (device) await adminDb().from("devices").update({ revoked_at: new Date().toISOString() }).eq("id", device.id);
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(`bk_${kind.data}`);
  return res;
}
