import { headers } from "next/headers";
import QRCode from "qrcode";
import { rolesFor } from "@/lib/admin-nav";
import { requireStaff, staffDb } from "@/lib/auth";
import { getLang } from "@/lib/db";
import { dict } from "@/lib/i18n";
import { PrintButton } from "./PrintButton";

// Printable QR stand cards: one per branch, opening that branch's menu directly.
export default async function QrPage() {
  const staff = await requireStaff(rolesFor("qr"));
  const lang = await getLang();
  const t = dict[lang].admin.qr;
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
  let q = (await staffDb()).from("branches").select("id, slug, name_ar, name_en").order("sort");
  if (staff.role !== "owner") q = q.eq("id", staff.branchId!);
  const { data: branches } = await q;
  const cards = await Promise.all((branches ?? []).map(async (b) => ({
    ...b,
    url: `${origin}/b/${b.slug}`,
    qr: await QRCode.toDataURL(`${origin}/b/${b.slug}`, { errorCorrectionLevel: "H", margin: 1, width: 600, color: { dark: "#2A1210", light: "#FFFFFF" } }),
  })));

  return (
    <>
      <div className="no-print flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">{t.note} <code dir="ltr">{origin}</code></p>
        <PrintButton label={t.print} />
      </div>
      <div className="qr-sheet">
        {cards.map((b) => (
          <article key={b.id} className="qr-card">
            <div className="qr-brand">البركة <span>El Baraka</span></div>
            <p className="qr-skip">{dict.ar.admin.qr.skip}</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={b.qr} alt={b.url} />
            <p className="qr-branch">{b.name_ar} · {b.name_en}</p>
            <p className="qr-scan">{dict.ar.admin.qr.scan} · {dict.en.admin.qr.scan}</p>
            <p className="qr-hot">{dict.ar.admin.qr.hotline} <b>16099</b></p>
          </article>
        ))}
      </div>
    </>
  );
}
