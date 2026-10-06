import { getLang, getRider, riderView } from "@/lib/db";
import { RiderBoard } from "./RiderBoard";
import { RiderLogin } from "./RiderLogin";

export const metadata = { title: "الطيار | El Baraka" };

export default async function RiderPage() {
  const [lang, rider] = await Promise.all([getLang(), getRider()]);
  if (!rider) return <RiderLogin lang={lang} />;
  return <RiderBoard lang={lang} rider={{ name: rider.name, branchId: rider.branchId, branch: rider.branch }} initial={await riderView(rider.id, rider.shiftStart)} />;
}
