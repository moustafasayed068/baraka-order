// Server-side price calculation. Client prices are never trusted; every unit price comes from the DB rows passed in.

export type DbOption = { id: string; name_ar: string; name_en: string; price_delta: number; active: boolean };
export type DbItem = {
  id: string;
  name_ar: string;
  name_en: string;
  base_price: number;
  active: boolean;
  item_options: DbOption[];
};
export type CartLine = { itemId: string; optionId: string | null; qty: number };
export type PricedLine = {
  item_id: string;
  option_id: string | null;
  name_ar: string;
  name_en: string;
  option_ar: string | null;
  option_en: string | null;
  unit_price: number;
  qty: number;
};

export type PriceResult =
  | { ok: true; lines: PricedLine[]; subtotal: number }
  | { ok: false; error: "item_unavailable" | "bad_option"; itemId: string };

export function priceLines(lines: CartLine[], items: Map<string, DbItem>): PriceResult {
  const priced: PricedLine[] = [];
  for (const l of lines) {
    const item = items.get(l.itemId);
    if (!item || !item.active) return { ok: false, error: "item_unavailable", itemId: l.itemId };
    const options = item.item_options.filter((o) => o.active);
    const option = l.optionId ? options.find((o) => o.id === l.optionId) : undefined;
    // items with options need exactly one of them; items without options take none
    if (options.length ? !option : l.optionId !== null) return { ok: false, error: "bad_option", itemId: l.itemId };
    priced.push({
      item_id: item.id,
      option_id: option?.id ?? null,
      name_ar: item.name_ar,
      name_en: item.name_en,
      option_ar: option?.name_ar ?? null,
      option_en: option?.name_en ?? null,
      unit_price: item.base_price + (option?.price_delta ?? 0),
      qty: l.qty,
    });
  }
  return { ok: true, lines: priced, subtotal: priced.reduce((s, l) => s + l.unit_price * l.qty, 0) };
}
