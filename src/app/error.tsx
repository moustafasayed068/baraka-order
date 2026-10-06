"use client";
import Link from "next/link";
import { dict } from "@/lib/i18n";

export default function Error({ reset }: { error: Error; reset: () => void }) {
  const t = dict[typeof document !== "undefined" && document.documentElement.lang === "en" ? "en" : "ar"];
  return (
    <main className="shell items-center justify-center gap-4 p-6 text-center">
      <div className="display text-5xl text-red">{t.brand}</div>
      <p className="text-lg font-semibold">{t.errorPage}</p>
      <button type="button" className="btn max-w-60" onClick={reset}>{t.retry}</button>
      <Link href="/" className="btn alt max-w-60">{t.goHome}</Link>
    </main>
  );
}
