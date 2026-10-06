import { ActionForm } from "@/components/ActionForm";
import { rolesFor } from "@/lib/admin-nav";
import { requireStaff, staffDb } from "@/lib/auth";
import { getLang, photoBase } from "@/lib/db";
import { dict, pick } from "@/lib/i18n";
import { removePhoto, saveItem, saveOption, uploadPhoto } from "./actions";

type Opt = { id: string; kind: "size" | "sauce"; name_ar: string; name_en: string; price_delta: number; sort: number; active: boolean };
type Item = {
  id: string; category_id: string; name_ar: string; name_en: string; desc_ar: string; desc_en: string; base_price: number;
  sort: number; is_meal: boolean; active: boolean; photo_url: string | null; item_options: Opt[];
};

export default async function MenuEditor() {
  await requireStaff(rolesFor("menu"));
  const lang = await getLang();
  const a = dict[lang].admin;
  const t = a.mn;
  const db = await staffDb(); // owner sees hidden items too (RLS)
  const [{ data: cats }, { data: items, error }, base] = await Promise.all([
    db.from("categories").select("id, name_ar, name_en").order("sort"),
    db.from("menu_items").select("id, category_id, name_ar, name_en, desc_ar, desc_en, base_price, sort, is_meal, active, photo_url, item_options(id, kind, name_ar, name_en, price_delta, sort, active)").order("sort"),
    photoBase(),
  ]);
  if (error) throw error;
  const form = { submit: a.save, saved: a.saved, failed: a.error, errors: { badPhoto: t.badPhoto } };

  const itemFields = (i?: Item) => {
    const id = (k: string) => `i-${i?.id ?? "new"}-${k}`;
    return (
    <>
      {i && <input type="hidden" name="id" value={i.id} />}
      <div className="field"><label htmlFor={id("name_ar")}>{t.nameAr}</label><input id={id("name_ar")} name="name_ar" defaultValue={i?.name_ar} required maxLength={80} /></div>
      <div className="field"><label htmlFor={id("name_en")}>{t.nameEn}</label><input id={id("name_en")} name="name_en" dir="ltr" defaultValue={i?.name_en} required maxLength={80} /></div>
      <div className="field"><label htmlFor={id("base_price")}>{t.price}</label><input id={id("base_price")} name="base_price" type="number" min={0} defaultValue={i?.base_price} required /></div>
      <div className="field">
        <label htmlFor={id("category_id")}>{t.category}</label>
        <select id={id("category_id")} name="category_id" className="select" defaultValue={i?.category_id ?? cats![0].id}>{cats!.map((c) => <option key={c.id} value={c.id}>{pick(c, lang)}</option>)}</select>
      </div>
      <div className="field"><label htmlFor={id("desc_ar")}>{t.descAr}</label><input id={id("desc_ar")} name="desc_ar" defaultValue={i?.desc_ar} maxLength={300} /></div>
      <div className="field"><label htmlFor={id("desc_en")}>{t.descEn}</label><input id={id("desc_en")} name="desc_en" dir="ltr" defaultValue={i?.desc_en} maxLength={300} /></div>
      <div className="field"><label htmlFor={id("sort")}>{t.sort}</label><input id={id("sort")} name="sort" type="number" min={0} defaultValue={i?.sort ?? 99} /></div>
      <label className="flex min-h-11 items-center gap-2"><input type="checkbox" name="active" defaultChecked={i?.active ?? true} className="size-5" />{t.visible}</label>
      <label className="flex min-h-11 items-center gap-2"><input type="checkbox" name="is_meal" defaultChecked={i?.is_meal} className="size-5" />{t.isMeal}</label>
    </>
    );
  };

  const optionFields = (itemId: string, o?: Opt) => {
    const id = (k: string) => `o-${o?.id ?? `new-${itemId}`}-${k}`;
    return (
    <>
      {o && <input type="hidden" name="id" value={o.id} />}
      <input type="hidden" name="item_id" value={itemId} />
      <div className="field">
        <label htmlFor={id("kind")}>{t.kind}</label>
        <select id={id("kind")} name="kind" className="select" defaultValue={o?.kind ?? "size"}><option value="size">{t.size}</option><option value="sauce">{t.sauce}</option></select>
      </div>
      <div className="field"><label htmlFor={id("name_ar")}>{t.nameAr}</label><input id={id("name_ar")} name="name_ar" defaultValue={o?.name_ar} required maxLength={60} /></div>
      <div className="field"><label htmlFor={id("name_en")}>{t.nameEn}</label><input id={id("name_en")} name="name_en" dir="ltr" defaultValue={o?.name_en} required maxLength={60} /></div>
      <div className="field"><label htmlFor={id("price_delta")}>{t.extra}</label><input id={id("price_delta")} name="price_delta" type="number" min={0} defaultValue={o?.price_delta ?? 0} /></div>
      <div className="field"><label htmlFor={id("sort")}>{t.sort}</label><input id={id("sort")} name="sort" type="number" min={0} defaultValue={o?.sort ?? 9} /></div>
      {o && <label className="flex min-h-11 items-center gap-2"><input type="checkbox" name="active" defaultChecked={o.active} className="size-5" />{t.visible}</label>}
    </>
    );
  };

  return (
    <>
      <p className="banner m-0!">{t.liveNote}</p>
      <details className="card">
        <summary className="cursor-pointer font-bold">+ {t.addItem}</summary>
        <ActionForm action={saveItem} {...form}>{itemFields()}</ActionForm>
      </details>

      {cats!.map((c) => (
        <section key={c.id} className="grid gap-2">
          <h2 className="display text-2xl text-red">{pick(c, lang)}</h2>
          {(items as Item[]).filter((i) => i.category_id === c.id).map((i) => (
            <details key={i.id} className={`card ${i.active ? "" : "opacity-60"}`}>
              <summary className="flex cursor-pointer flex-wrap items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {i.photo_url ? <img src={base + i.photo_url} alt="" className="size-12 rounded-lg object-cover" /> : <span className="plate size-12! text-xs!">{i.name_ar}</span>}
                <b>{pick(i, lang)}</b>
                <span className="price num">{i.base_price}</span>
                {!i.active && <span className="ktag dark">{t.hidden}</span>}
              </summary>
              <ActionForm action={saveItem} {...form}>{itemFields(i)}</ActionForm>

              <h3 className="font-bold">{t.photo}</h3>
              <ActionForm action={uploadPhoto} {...form} submit={t.upload}>
                <input type="hidden" name="id" value={i.id} />
                <div className="field"><label htmlFor={`photo-${i.id}`}>{t.photoHint}</label><input id={`photo-${i.id}`} name="photo" type="file" accept="image/jpeg,image/png,image/webp" required /></div>
              </ActionForm>
              {i.photo_url && (
                <form action={removePhoto}><input type="hidden" name="id" value={i.id} /><button type="submit" className="chip text-red!">{t.removePhoto}</button></form>
              )}

              <h3 className="font-bold">{t.options}</h3>
              {[...i.item_options].sort((x, y) => x.sort - y.sort).map((o) => (
                <ActionForm key={o.id} action={saveOption} {...form}>{optionFields(i.id, o)}</ActionForm>
              ))}
              <details>
                <summary className="cursor-pointer">+ {t.addOption}</summary>
                <ActionForm action={saveOption} {...form}>{optionFields(i.id)}</ActionForm>
              </details>
            </details>
          ))}
        </section>
      ))}
    </>
  );
}
