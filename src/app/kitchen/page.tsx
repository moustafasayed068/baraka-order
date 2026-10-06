import { PairForm } from "@/components/PairForm";
import { branchList, getDevice, getLang, kitchenOrders } from "@/lib/db";
import { Board } from "./Board";

export const metadata = { title: "المطبخ | El Baraka" };

export default async function KitchenPage() {
  const [lang, device] = await Promise.all([getLang(), getDevice("kitchen")]);
  if (!device) return <PairForm lang={lang} kind="kitchen" branches={await branchList()} />;
  return <Board lang={lang} branch={device.branch} initial={await kitchenOrders(device.branch.id)} />;
}
