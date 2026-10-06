import { describe, expect, it } from "vitest";
import { priceLines, type DbItem } from "./pricing";
import { inPolygon, matchZone, type Pt } from "./geo";
import { isOpenAt } from "./hours";

const strips: DbItem = {
  id: "strips", name_ar: "وجبة ستربس", name_en: "Strips Meal", base_price: 155, active: true,
  item_options: [
    { id: "s3", name_ar: "3 قطع", name_en: "3 pcs", price_delta: 0, active: true },
    { id: "s5", name_ar: "5 قطع", name_en: "5 pcs", price_delta: 60, active: true },
  ],
};
const water: DbItem = { id: "water", name_ar: "مياه", name_en: "Water", base_price: 10, active: true, item_options: [] };
const hidden: DbItem = { ...water, id: "hidden", active: false };
const menu = new Map([strips, water, hidden].map((i) => [i.id, i]));

describe("priceLines", () => {
  it("prices from the database, with option deltas", () => {
    const r = priceLines([{ itemId: "strips", optionId: "s5", qty: 2 }, { itemId: "water", optionId: null, qty: 3 }], menu);
    expect(r).toMatchObject({ ok: true, subtotal: 215 * 2 + 30 });
  });
  it("rejects hidden or unknown items", () => {
    expect(priceLines([{ itemId: "hidden", optionId: null, qty: 1 }], menu)).toMatchObject({ ok: false, error: "item_unavailable" });
    expect(priceLines([{ itemId: "nope", optionId: null, qty: 1 }], menu)).toMatchObject({ ok: false, error: "item_unavailable" });
  });
  it("requires exactly one valid option", () => {
    expect(priceLines([{ itemId: "strips", optionId: null, qty: 1 }], menu)).toMatchObject({ ok: false, error: "bad_option" });
    expect(priceLines([{ itemId: "strips", optionId: "other", qty: 1 }], menu)).toMatchObject({ ok: false, error: "bad_option" });
    expect(priceLines([{ itemId: "water", optionId: "s5", qty: 1 }], menu)).toMatchObject({ ok: false, error: "bad_option" });
  });
});

describe("isOpenAt (Africa/Cairo, crossing midnight)", () => {
  // Cairo is UTC+3 in summer (October 6 2026 is still summer time until the last Thursday of October)
  const at = (utc: string) => new Date(`2026-10-06T${utc}:00Z`);
  it("09:00–04:00", () => {
    expect(isOpenAt("09:00", "04:00", at("05:59"))).toBe(false); // 08:59 Cairo
    expect(isOpenAt("09:00", "04:00", at("06:00"))).toBe(true); // 09:00
    expect(isOpenAt("09:00", "04:00", at("22:30"))).toBe(true); // 01:30 next day
    expect(isOpenAt("09:00", "04:00", at("01:00"))).toBe(false); // 04:00 → closed
  });
  it("same-day hours", () => {
    expect(isOpenAt("10:00", "22:00", at("08:00"))).toBe(true); // 11:00
    expect(isOpenAt("10:00", "22:00", at("19:00"))).toBe(false); // 22:00
  });
});


describe("zone matching", () => {
  // rough square around Smouha, Alexandria
  const smouha: Pt[] = [[31.20, 29.93], [31.20, 29.96], [31.22, 29.96], [31.22, 29.93]];
  it("point in polygon", () => {
    expect(inPolygon([31.21, 29.945], smouha)).toBe(true);
    expect(inPolygon([31.25, 29.945], smouha)).toBe(false);
  });
  it("picks the zone that covers the pin, skips zones without a polygon", () => {
    const zones = [{ id: "sample", polygon: null }, { id: "smouha", polygon: smouha }];
    expect(matchZone([31.21, 29.945], zones)?.id).toBe("smouha");
    expect(matchZone([30.04, 31.23], zones)).toBeUndefined(); // Cairo: no zone, offer pickup
  });
});
