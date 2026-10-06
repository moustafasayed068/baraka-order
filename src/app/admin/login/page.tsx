import { redirect } from "next/navigation";
import { getStaff } from "@/lib/auth";
import { getLang } from "@/lib/db";
import { LoginForm } from "./LoginForm";

export const metadata = { title: "الإدارة | El Baraka" };

export default async function LoginPage() {
  if (await getStaff()) redirect("/admin");
  return <LoginForm lang={await getLang()} />;
}
