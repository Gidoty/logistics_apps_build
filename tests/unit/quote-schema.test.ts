import { describe, expect, it } from "vitest";
import { isOverBudget, sendQuoteInputSchema, sumLines } from "@/lib/orders/quote-lines";
import { calculateLandedCost } from "@/lib/pricing/engine";
import { chinaInput, fxRows, rules } from "./pricing-fixtures";
import { createLinkOrderSchema } from "@/lib/orders/schemas";
import { createThrottle } from "@/lib/security/throttle";
import { normalizeNigerianPhone } from "@/lib/profile/phone";

const ORDER = "11111111-1111-4111-8111-111111111111";

describe("send quote input", () => {
  const snapshot = calculateLandedCost(chinaInput(), rules(), fxRows()).snapshot;
  const base = (extra = {}) => ({
    orderId: ORDER,
    snapshot: JSON.parse(JSON.stringify(snapshot)),
    lines: [{ calcType: "item_price", label: "Item price", amount: "83333.33", reason: "" }],
    expiresInHours: "48",
    ...extra,
  });

  it("accepts a calculated quote and has no total field", () => {
    const result = sendQuoteInputSchema.safeParse(base({ totalMinor: 1, total: "0.01" }));
    expect(result.success).toBe(true);
    expect(result.success && "totalMinor" in result.data).toBe(false);
  });

  it("allows only 24, 48 or 72 hours", () => {
    for (const hours of ["24", 48, "72"])
      expect(sendQuoteInputSchema.safeParse(base({ expiresInHours: hours })).success).toBe(true);
    for (const hours of ["12", "49", "0", "abc", "-1"])
      expect(sendQuoteInputSchema.safeParse(base({ expiresInHours: hours })).success).toBe(false);
  });

  it("needs at least one line and refuses unknown line types", () => {
    expect(sendQuoteInputSchema.safeParse(base({ lines: [] })).success).toBe(false);
    expect(
      sendQuoteInputSchema.safeParse(
        base({ lines: [{ calcType: "bogus", label: "x", amount: "1", reason: "" }] }),
      ).success,
    ).toBe(false);
  });

  it("refuses a malformed snapshot", () => {
    const broken = base();
    broken.snapshot.input.quantity = 0;
    expect(sendQuoteInputSchema.safeParse(broken).success).toBe(false);
    expect(sendQuoteInputSchema.safeParse(base({ snapshot: { engine_version: "1" } })).success).toBe(false);
  });

  it("keeps the over-budget tick off by default and trims notes", () => {
    const result = sendQuoteInputSchema.safeParse(base({ internalNotes: "  call vendor " }));
    expect(result.success && result.data.confirmOverBudget).toBe(false);
    expect(result.success && result.data.internalNotes).toBe("call vendor");
  });

  it("knows when a total is over the budget", () => {
    expect(isOverBudget(17650, 10000)).toBe(true);
    expect(isOverBudget(10000, 10000)).toBe(false);
    expect(isOverBudget(5, null)).toBe(false);
    expect(sumLines([{ amountMinor: 5 }, { amountMinor: 7 }])).toBe(12);
  });
});

describe("link order schema", () => {
  const schema = createLinkOrderSchema({ currencies: { NGN: 2, USD: 2 } });
  const RECIPIENT = "55555555-5555-4555-8555-555555555555";
  const valid = (extra = {}) => ({
    productUrl: "Look https://www.aliexpress.com/item/1.html?x=1 please",
    quantity: "2",
    buyerCurrency: "usd",
    recipientId: RECIPIENT,
    ...extra,
  });

  it("parses a pasted sentence into clean fields", () => {
    const result = schema.safeParse(valid({ maxBudget: "150.5", variantNotes: " blue ", buyerNotes: "" }));
    expect(result.success && result.data).toEqual({
      sourceUrl: "https://www.aliexpress.com/item/1.html?x=1",
      host: "www.aliexpress.com",
      quantity: 2,
      variantNotes: "blue",
      buyerNotes: null,
      maxBudgetMinor: 15050,
      buyerCurrency: "USD",
      recipientId: RECIPIENT,
    });
  });

  it("rejects bad input", () => {
    expect(schema.safeParse(valid({ productUrl: "http://x.test/a" })).success).toBe(false);
    expect(schema.safeParse(valid({ quantity: "0" })).success).toBe(false);
    expect(schema.safeParse(valid({ quantity: "101" })).success).toBe(false);
    expect(schema.safeParse(valid({ quantity: "1.5" })).success).toBe(false);
    expect(schema.safeParse(valid({ buyerCurrency: "EUR" })).success).toBe(false);
    expect(schema.safeParse(valid({ recipientId: "nope" })).success).toBe(false);
    expect(schema.safeParse(valid({ maxBudget: "12.345" })).success).toBe(false);
    expect(schema.safeParse(valid({ variantNotes: "x".repeat(501) })).success).toBe(false);
  });
});

describe("normalizeNigerianPhone", () => {
  it.each([
    "08031234567",
    "0803 123 4567",
    "+2348031234567",
    "2348031234567",
    "8031234567",
    "+234 803 123 4567",
  ])("normalizes %s", (input) => {
    expect(normalizeNigerianPhone(input)).toBe("+2348031234567");
  });
  it.each([
    "",
    "0123456789",
    "0603123456",
    "+447700900123",
    "0803123456",
    "080312345678",
    "abc",
    "0803-123-45x7",
  ])("rejects %j", (input) => {
    expect(normalizeNigerianPhone(input)).toBeNull();
  });
});

describe("createThrottle", () => {
  it("allows up to the limit per key, then recovers", () => {
    let now = 0;
    const throttle = createThrottle(3, 1000, () => now);
    expect([1, 2, 3, 4].map(() => throttle.allow("a"))).toEqual([true, true, true, false]);
    expect(throttle.allow("b")).toBe(true);
    now = 1001;
    expect(throttle.allow("a")).toBe(true);
  });
});
