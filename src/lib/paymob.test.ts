import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { hmacFor, verifyHmac, HMAC_FIELDS } = await import("./paymob");

const obj = {
  amount_cents: 24000, created_at: "2026-10-13T20:00:00.000000", currency: "EGP", error_occured: false,
  has_parent_transaction: false, id: 192036465, integration_id: 4100000, is_3d_secure: true, is_auth: false,
  is_capture: false, is_refunded: false, is_standalone_payment: true, is_voided: false, order: { id: 217503754 },
  owner: 302852, pending: false, source_data: { pan: "2346", sub_type: "MasterCard", type: "card" }, success: true,
};

describe("paymob webhook hmac", () => {
  it("concatenates the 20 fields in order and signs with SHA-512", () => {
    expect(HMAC_FIELDS).toHaveLength(20);
    const msg = "24000" + "2026-10-13T20:00:00.000000" + "EGP" + "false" + "false" + "192036465" + "4100000" + "true" + "false" +
      "false" + "false" + "true" + "false" + "217503754" + "302852" + "false" + "2346" + "MasterCard" + "card" + "true";
    expect(hmacFor(obj, "s3cret")).toBe(createHmac("sha512", "s3cret").update(msg).digest("hex"));
  });
  it("accepts the right signature and rejects tampering", () => {
    const sig = hmacFor(obj, "s3cret");
    expect(verifyHmac(obj, sig, "s3cret")).toBe(true);
    expect(verifyHmac(obj, sig.toUpperCase(), "s3cret")).toBe(true);
    expect(verifyHmac({ ...obj, amount_cents: 100 }, sig, "s3cret")).toBe(false);
    expect(verifyHmac(obj, sig, "other")).toBe(false);
    expect(verifyHmac(obj, null, "s3cret")).toBe(false);
    expect(verifyHmac(obj, "zz", "s3cret")).toBe(false);
  });
});
