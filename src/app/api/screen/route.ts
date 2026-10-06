import { NextResponse } from "next/server";
import { getDevice, screenNumbers } from "@/lib/db";

export async function GET() {
  const device = await getDevice("screen");
  if (!device) return NextResponse.json({ error: "unpaired" }, { status: 401 });
  return NextResponse.json(await screenNumbers(device.branch.id), { headers: { "Cache-Control": "no-store" } });
}
