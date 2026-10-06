import { describe, expect, it } from "vitest";
import { priceLines, type DbItem } from "./pricing";
import { distanceKm, nearestBranch } from "./geo";
import { businessDate, isOpenAt } from "./hours";
import { totp } from "./totp";

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


describe("delivery by distance", () => {
  const smouha = { slug: "smouha", lat: 31.2065, lng: 29.95, maxKm: 7 };
  const sidiBishr = { slug: "sidi-bishr", lat: 31.256, lng: 29.988, maxKm: 7 };
  it("distance is about right", () => {
    expect(distanceKm([31.2065, 29.95], [31.256, 29.988])).toBeCloseTo(6.5, 0); // Smouha to Sidi Bishr
  });
  it("picks the nearest branch in range, none when too far", () => {
    expect(nearestBranch([31.25, 29.98], [smouha, sidiBishr])?.b.slug).toBe("sidi-bishr");
    expect(nearestBranch([31.21, 29.94], [smouha, sidiBishr])?.b.slug).toBe("smouha");
    expect(nearestBranch([30.04, 31.23], [smouha, sidiBishr])).toBeUndefined(); // Cairo: offer pickup
  });
});

describe("totp", () => {
  it("matches the RFC 6238 test vector", () => {
    // secret "12345678901234567890" in base32, T = 59 s -> 287082 (last 6 digits of 94287082)
    expect(totp("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", 59_000)).toBe("287082");
  });
});

describe("businessDate (Cairo, 06:00 cut-off)", () => {
  it("after midnight still belongs to the previous day", () => {
    expect(businessDate(new Date("2026-10-06T22:30:00Z"))).toBe("2026-10-06"); // 01:30 Cairo on the 7th (UTC+3)
    expect(businessDate(new Date("2026-10-07T03:30:00Z"))).toBe("2026-10-07"); // 06:30 Cairo
  });
  it("winter time (UTC+2)", () => {
    expect(businessDate(new Date("2026-12-15T03:30:00Z"))).toBe("2026-12-14"); // 05:30 Cairo
    expect(businessDate(new Date("2026-12-15T04:30:00Z"))).toBe("2026-12-15"); // 06:30 Cairo
  });
});
