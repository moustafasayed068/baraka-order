import { notFound } from "next/navigation";
import { AppHead } from "@/components/AppHead";
import { getLang, getTracking } from "@/lib/db";
import { Tracker } from "./Tracker";

export default async function TrackPage({ params }: PageProps<"/t/[token]">) {
  const { token } = await params;
  const [lang, initial] = await Promise.all([getLang(), getTracking(token)]);
  if (!initial) notFound();
  return (
    <div className="shell">
      <AppHead lang={lang} excludeOrder={token} />
      <Tracker lang={lang} token={token} initial={initial} />
    </div>
  );
}

export const metadata = { referrer: "no-referrer" }; // keep the token out of Referer headers
