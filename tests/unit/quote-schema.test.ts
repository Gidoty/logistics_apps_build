import { describe, expect, it } from "vitest";
import { createQuoteSchema, isOverBudget, sumLines } from "@/lib/orders/quote-lines";
import { createLinkOrderSchema } from "@/lib/orders/schemas";
import { createThrottle } from "@/lib/security/throttle";
import { normalizeNigerianPhone } from "@/lib/profile/phone";

const ORDER = "11111111-1111-4111-8111-111111111111";
const CORRIDOR = "33333333-3333-4333-8333-333333333333";

const context = (overrides = {}) => ({
  currencyDigits: 2,
  maxBudgetMinor: null,
  needsCorridor: false,
  corridorIds: [CORRIDOR],
  ...overrides,
});

const FIVE_LINES = [
  { type: "item_price", label: "Phone", amount: "120.50" },
  { type: "service_fee", label: "Service fee", amount: "10" },
  { type: "international_freight", label: "Air freight", amount: "25.25" },
  { type: "customs_estimate", label: "Duty estimate", amount: "15" },
  { type: "last_mile_delivery", label: "Delivery to Port Harcourt", amount: "5.75" },
];

const base = (extra = {}) => ({
  orderId: ORDER,
  lines: FIVE_LINES,
  expiresInHours: "48",
  ...extra,
});

describe("quote schema", () => {
  it("works out the total on the server, in minor units", () => {
    const result = createQuoteSchema(context()).safeParse(base());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.totalMinor).toBe(17650);
      expect(result.data.lines).toHaveLength(5);
      expect(sumLines(result.data.lines)).toBe(result.data.totalMinor);
    }
  });

  it("ignores a total sent by the browser", () => {
    const result = createQuoteSchema(context()).safeParse(base({ totalMinor: 1, total: "0.01" }));
    expect(result.success && result.data.totalMinor).toBe(17650);
  });

  it("needs an item price line above zero", () => {
    const lines = FIVE_LINES.map((line) => (line.type === "item_price" ? { ...line, amount: "0" } : line));
    expect(createQuoteSchema(context()).safeParse(base({ lines })).success).toBe(false);
    const noItem = FIVE_LINES.filter((line) => line.type !== "item_price");
    expect(createQuoteSchema(context()).safeParse(base({ lines: noItem })).success).toBe(false);
  });

  it("checks line count, label, amount and type", () => {
    const schema = createQuoteSchema(context());
    expect(schema.safeParse(base({ lines: [] })).success).toBe(false);
    expect(
      schema.safeParse(base({ lines: Array(21).fill({ type: "item_price", label: "x", amount: "1" }) }))
        .success,
    ).toBe(false);
    expect(schema.safeParse(base({ lines: [{ type: "item_price", label: "", amount: "5" }] })).success).toBe(
      false,
    );
    expect(
      schema.safeParse(base({ lines: [{ type: "item_price", label: "x", amount: "1.999" }] })).success,
    ).toBe(false);
    expect(
      schema.safeParse(base({ lines: [{ type: "item_price", label: "x", amount: "abc" }] })).success,
    ).toBe(false);
    expect(schema.safeParse(base({ lines: [{ type: "bogus", label: "x", amount: "5" }] })).success).toBe(
      false,
    );
  });

  it("allows only 24, 48 or 72 hours", () => {
    const schema = createQuoteSchema(context());
    for (const hours of ["24", 48, "72"])
      expect(schema.safeParse(base({ expiresInHours: hours })).success).toBe(true);
    for (const hours of ["12", "49", "0", "abc", "-1"])
      expect(schema.safeParse(base({ expiresInHours: hours })).success).toBe(false);
  });

  it("reads the weight and internal notes", () => {
    const schema = createQuoteSchema(context());
    const ok = schema.safeParse(base({ weightGrams: "1500", internalNotes: "  call vendor " }));
    expect(ok.success && ok.data.weightGrams).toBe(1500);
    expect(ok.success && ok.data.internalNotes).toBe("call vendor");
    expect(schema.safeParse(base({ weightGrams: "0" })).success).toBe(false);
    expect(schema.safeParse(base({ weightGrams: "x" })).success).toBe(false);
    const empty = schema.safeParse(base());
    expect(empty.success && empty.data.weightGrams).toBeNull();
    expect(empty.success && empty.data.internalNotes).toBeNull();
  });

  it("requires the over-budget tick", () => {
    const schema = createQuoteSchema(context({ maxBudgetMinor: 10000 }));
    expect(schema.safeParse(base()).success).toBe(false);
    expect(schema.safeParse(base({ confirmOverBudget: true })).success).toBe(true);
    expect(isOverBudget(17650, 10000)).toBe(true);
    expect(isOverBudget(10000, 10000)).toBe(false);
    expect(isOverBudget(5, null)).toBe(false);
  });

  it("requires a valid corridor for an unknown store only", () => {
    const schema = createQuoteSchema(context({ needsCorridor: true }));
    expect(schema.safeParse(base()).success).toBe(false);
    expect(schema.safeParse(base({ corridorId: "44444444-4444-4444-8444-444444444444" })).success).toBe(
      false,
    );
    const ok = schema.safeParse(base({ corridorId: CORRIDOR }));
    expect(ok.success && ok.data.corridorId).toBe(CORRIDOR);
    const known = createQuoteSchema(context()).safeParse(base({ corridorId: CORRIDOR }));
    expect(known.success && known.data.corridorId).toBeNull();
  });

  it("uses the currency's decimal places", () => {
    const yen = createQuoteSchema(context({ currencyDigits: 0 })).safeParse(
      base({ lines: [{ type: "item_price", label: "x", amount: "1200" }] }),
    );
    expect(yen.success && yen.data.totalMinor).toBe(1200);
    expect(
      createQuoteSchema(context({ currencyDigits: 0 })).safeParse(
        base({ lines: [{ type: "item_price", label: "x", amount: "12.5" }] }),
      ).success,
    ).toBe(false);
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
