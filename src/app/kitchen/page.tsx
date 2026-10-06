import { PairForm } from "@/components/PairForm";
import { branchList, branchRiders, getDevice, getLang, kitchenOrders, requestTime } from "@/lib/db";
import { Board } from "./Board";

export const metadata = { title: "المطبخ | El Baraka" };

export default async function KitchenPage() {
  const [lang, device] = await Promise.all([getLang(), getDevice("kitchen")]);
  if (!device) return <PairForm lang={lang} kind="kitchen" branches={await branchList()} />;
  const [orders, riders] = await Promise.all([kitchenOrders(device.branch.id), branchRiders(device.branch.id)]);
  // the server-side clock reading goes along, so the first render on the tablet shows the same minutes
  return <Board lang={lang} branch={device.branch} initial={orders} riders={riders} serverNow={requestTime()} />;
}
