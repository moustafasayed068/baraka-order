import { headers } from "next/headers";
import QRCode from "qrcode";
import { PairForm } from "@/components/PairForm";
import { branchList, getDevice, getLang, screenNumbers } from "@/lib/db";
import { Tv } from "./Tv";

export const metadata = { title: "شاشة الاستلام | El Baraka" };

export default async function ScreenPage() {
  const [lang, device, h] = await Promise.all([getLang(), getDevice("screen"), headers()]);
  if (!device) return <PairForm lang={lang} kind="screen" branches={await branchList()} />;
  const origin = `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
  const qr = await QRCode.toDataURL(`${origin}/b/${device.branch.slug}`, { margin: 1, width: 220 });
  return <Tv lang={lang} branch={device.branch} qr={qr} initial={await screenNumbers(device.branch.id)} />;
}
