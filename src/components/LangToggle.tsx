"use client";
import { useRouter } from "next/navigation";
import type { Lang } from "@/lib/i18n";
import { dict } from "@/lib/i18n";

export function LangToggle({ lang }: { lang: Lang }) {
  const router = useRouter();
  return (
    <button
      type="button"
      className="pill"
      onClick={() => {
        document.cookie = `lang=${lang === "ar" ? "en" : "ar"}; path=/; max-age=31536000; samesite=lax`;
        router.refresh();
      }}
    >
      {dict[lang].switchLang}
    </button>
  );
}
