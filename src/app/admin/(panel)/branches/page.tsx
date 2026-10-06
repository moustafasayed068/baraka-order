import { ActionForm } from "@/components/ActionForm";
import { rolesFor } from "@/lib/admin-nav";
import { requireStaff, staffDb } from "@/lib/auth";
import { getLang } from "@/lib/db";
import { dict, pick } from "@/lib/i18n";
import { busyAction, revokeDevice, saveBranch, saveDelivery, setPin } from "./actions";

type Z = { id: string; fee: number; min_order: number; max_km: number; is_sample: boolean };
type D = { id: string; kind: "kitchen" | "screen"; created_at: string; revoked_at: string | null };

export default async function BranchesPage() {
  const staff = await requireStaff(rolesFor("branches"));
  const lang = await getLang();
  const a = dict[lang].admin;
  const t = a.br;
  const db = await staffDb();
  let q = db.from("branches")
    .select("id, slug, name_ar, name_en, opens_at, closes_at, accepts_orders, accepts_delivery, extra_wait_min, lat, lng, delivery_zones(id, fee, min_order, max_km, is_sample), devices(id, kind, created_at, revoked_at)")
    .order("sort");
  if (staff.role !== "owner") q = q.eq("id", staff.branchId!);
  const { data, error } = await q;
  if (error) throw error;

  return data.map((b) => {
    const zone = (b.delivery_zones as Z[]).sort((x, y) => x.fee - y.fee)[0];
    const devices = (b.devices as D[]).filter((d) => !d.revoked_at);
    const busy = [b.accepts_orders ? ["pause", t.pauseNow] : ["resume", t.resumeNow], ["plus10", t.plus10], ["reset", t.resetWait]] as const;
    return (
      <section key={b.id} className="card">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2>{pick(b, lang)}</h2>
          <div className="flex flex-wrap gap-2">
            <span className={`ktag ${b.accepts_orders ? "" : "dark"}`}>{b.accepts_orders ? t.acceptsOrders : t.paused}</span>
            {b.extra_wait_min > 0 && <span className="ktag num">+{b.extra_wait_min}</span>}
          </div>
        </div>

        <div className="flex flex-wrap gap-2" aria-label={t.busy}>
          {busy.map(([what, label]) => (
            <form key={what} action={busyAction}>
              <input type="hidden" name="id" value={b.id} />
              <input type="hidden" name="what" value={what} />
              <button type="submit" className={`chip ${what === "pause" ? "border-red! text-red!" : ""}`}>{label}</button>
            </form>
          ))}
        </div>

        <h3 className="font-bold">{t.hours}</h3>
        <ActionForm action={saveBranch} submit={a.save} saved={a.saved} failed={a.error}>
          <input type="hidden" name="id" value={b.id} />
          <div className="field"><label htmlFor={`o-${b.id}`}>{t.opens}</label><input id={`o-${b.id}`} name="opens_at" type="time" defaultValue={b.opens_at.slice(0, 5)} required /></div>
          <div className="field"><label htmlFor={`c-${b.id}`}>{t.closes}</label><input id={`c-${b.id}`} name="closes_at" type="time" defaultValue={b.closes_at.slice(0, 5)} required /></div>
          <div className="field"><label htmlFor={`w-${b.id}`}>{t.extraWait}</label><input id={`w-${b.id}`} name="extra_wait_min" type="number" min={0} max={120} defaultValue={b.extra_wait_min} /></div>
          <label className="flex min-h-11 items-center gap-2"><input type="checkbox" name="accepts_orders" defaultChecked={b.accepts_orders} className="size-5" />{t.acceptsOrders}</label>
          <label className="flex min-h-11 items-center gap-2"><input type="checkbox" name="accepts_delivery" defaultChecked={b.accepts_delivery} className="size-5" />{t.acceptsDelivery}</label>
          <div className="field"><label htmlFor={`la-${b.id}`}>{t.lat}</label><input id={`la-${b.id}`} name="lat" type="number" step="0.000001" dir="ltr" defaultValue={b.lat ?? ""} required /></div>
          <div className="field"><label htmlFor={`ln-${b.id}`}>{t.lng}</label><input id={`ln-${b.id}`} name="lng" type="number" step="0.000001" dir="ltr" defaultValue={b.lng ?? ""} required /></div>
          <p className="text-sm text-muted">
            {t.location}: {t.mapsHint} ·{" "}
            <a className="underline" target="_blank" rel="noopener noreferrer" href={`https://www.google.com/maps/search/?api=1&query=${b.lat},${b.lng}`}>{t.openMap}</a>
          </p>
        </ActionForm>

        {zone && (
          <>
            <h3 className="font-bold">{t.delivery} {zone.is_sample && <span className="ktag">{t.approx}</span>}</h3>
            <ActionForm action={saveDelivery} submit={a.save} saved={a.saved} failed={a.error}>
              <input type="hidden" name="id" value={zone.id} />
              <div className="field"><label htmlFor={`f-${b.id}`}>{t.fee}</label><input id={`f-${b.id}`} name="fee" type="number" min={0} defaultValue={zone.fee} required /></div>
              <div className="field"><label htmlFor={`m-${b.id}`}>{t.minOrder}</label><input id={`m-${b.id}`} name="min_order" type="number" min={0} defaultValue={zone.min_order} required /></div>
              <div className="field"><label htmlFor={`k-${b.id}`}>{t.maxKm}</label><input id={`k-${b.id}`} name="max_km" type="number" min={0.5} step="0.5" defaultValue={zone.max_km} required /></div>
            </ActionForm>
          </>
        )}

        <h3 className="font-bold">{t.kitchenPin}</h3>
        <ActionForm action={setPin} submit={a.save} saved={a.saved} failed={a.error}>
          <input type="hidden" name="id" value={b.id} />
          <div className="field"><label htmlFor={`p-${b.id}`}>{t.newPin}</label><input id={`p-${b.id}`} name="pin" type="password" inputMode="numeric" pattern="[0-9]{4,8}" autoComplete="new-password" dir="ltr" required /></div>
        </ActionForm>

        <h3 className="font-bold">{t.devices}</h3>
        {devices.length === 0 ? <p className="text-muted">{t.noDevices}</p> : (
          <ul className="grid gap-1">
            {devices.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-2">
                <span>{d.kind === "kitchen" ? t.kitchen : t.screen} · {t.pairedOn} {new Date(d.created_at).toLocaleDateString(lang === "ar" ? "ar-EG" : "en-GB", { timeZone: "Africa/Cairo" })}</span>
                <form action={revokeDevice}><input type="hidden" name="id" value={d.id} /><button type="submit" className="chip text-red!">{t.revoke}</button></form>
              </li>
            ))}
          </ul>
        )}
      </section>
    );
  });
}
