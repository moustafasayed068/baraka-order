import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans_Arabic, Lalezar } from "next/font/google";
import { getLang } from "@/lib/db";
import "./globals.css";

const display = Lalezar({ variable: "--ff-lalezar", weight: "400", subsets: ["arabic", "latin"] });
const body = IBM_Plex_Sans_Arabic({ variable: "--ff-plex", weight: ["400", "500", "600", "700"], subsets: ["arabic", "latin"] });

export const metadata: Metadata = {
  title: "البركة | El Baraka — اطلب واستلم",
  description: "اطلب من البركة فرايد تشيكن واستلم من غير طابور",
};
export const viewport: Viewport = { themeColor: "#D9161C", viewportFit: "cover" };

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const lang = await getLang();
  return (
    <html lang={lang} dir={lang === "ar" ? "rtl" : "ltr"} className={`${display.variable} ${body.variable}`}>
      <body>{children}</body>
    </html>
  );
}
