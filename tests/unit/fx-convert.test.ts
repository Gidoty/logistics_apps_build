import { describe, expect, it } from "vitest";
import { convertMinor, resolveRate, type FxRow } from "@/lib/fx/convert";
import { parseScaled, roundHalfUpDiv } from "@/lib/fx/decimal";
import { PricingError } from "@/lib/pricing/errors";
import { NOW, fxRows } from "./pricing-fixtures";

const now = new Date(NOW);
const digits: Record<string, number> = { NGN: 2, USD: 2, GBP: 2, CNY: 2, JPY: 0 };

function convert(minor: number, from: string, to: string, rows: FxRow[] = fxRows()): number {
  const { ratio } = resolveRate(from, to, rows, now);
  return Number(convertMinor(BigInt(minor), digits[from], digits[to], ratio));
}

describe("exact decimal helpers", () => {
  it("rounds half up", () => {
    expect(roundHalfUpDiv(5n, 10n)).toBe(1n); // 0.5 -> 1
    expect(roundHalfUpDiv(4n, 10n)).toBe(0n);
    expect(roundHalfUpDiv(15n, 10n)).toBe(2n); // 1.5 -> 2
    expect(roundHalfUpDiv(14n, 10n)).toBe(1n);
  });
  it("reads decimals exactly, from text and from database numbers", () => {
    expect(parseScaled("1650.12345678", 8)).toBe(165012345678n);
    expect(parseScaled(1650.12345678, 8)).toBe(165012345678n);
    expect(parseScaled("0.1", 8)).toBe(10000000n);
    expect(parseScaled("5", 4)).toBe(50000n);
    expect(parseScaled("1.23456", 4)).toBe(12346n); // beyond the scale: rounded half up
  });
  it("refuses negative and non-numeric values", () => {
    expect(() => parseScaled("-1", 2)).toThrow(PricingError);
    expect(() => parseScaled("abc", 2)).toThrow(PricingError);
    expect(() => parseScaled(Number.NaN, 2)).toThrow(PricingError);
  });
});

describe("conversion between NGN, USD, GBP and CNY", () => {
  // 1 USD = 1500 NGN = 7.2 CNY = 0.8 GBP
  it("converts from USD", () => {
    expect(convert(1000, "USD", "NGN")).toBe(1_500_000); // $10.00 -> NGN 15,000.00
    expect(convert(1000, "USD", "GBP")).toBe(800);
    expect(convert(1000, "USD", "CNY")).toBe(7200);
  });
  it("converts to USD", () => {
    expect(convert(1_500_000, "NGN", "USD")).toBe(1000);
    expect(convert(800, "GBP", "USD")).toBe(1000);
    expect(convert(7200, "CNY", "USD")).toBe(1000);
  });
  it("derives other pairs through USD", () => {
    expect(convert(8000, "GBP", "NGN")).toBe(15_000_000); // GBP 80.00 -> NGN 150,000.00
    expect(convert(7200, "CNY", "GBP")).toBe(800);
    expect(convert(15_000_000, "NGN", "CNY")).toBe(72_000);
  });
  it("rounds half up, not down or to even", () => {
    // NGN 0.01 = 1 kobo -> GBP: 1 x 0.8 / 1500 = 0.000533 pence -> 0
    expect(convert(1, "NGN", "GBP")).toBe(0);
    // 938 kobo -> 938 x 0.8/1500 = 0.5003 pence -> 1
    expect(convert(938, "NGN", "GBP")).toBe(1);
    // 937 kobo -> 0.49973 pence -> 0
    expect(convert(937, "NGN", "GBP")).toBe(0);
  });
  it("adjusts for currencies with different minor digits", () => {
    const rows = [...fxRows(), { ...fxRows()[0], id: "fx-usd-jpy", quote: "JPY", rate: "150.00000000" }];
    // USD 10.00 (1000 cents) -> JPY 1,500 (no minor unit)
    expect(convert(1000, "USD", "JPY", rows)).toBe(1500);
    // JPY 1,500 -> USD 10.00
    expect(convert(1500, "JPY", "USD", rows)).toBe(1000);
  });
  it("keeps full precision for large amounts", () => {
    // NGN 9,000,000,000.00 to USD without a float in sight
    expect(convert(900_000_000_000, "NGN", "USD")).toBe(600_000_000);
  });
  it("does not convert within one currency", () => {
    expect(convert(12345, "NGN", "NGN")).toBe(12345);
  });
});

describe("stale rates", () => {
  it("throws FX_STALE when a needed rate is older than 24 hours", () => {
    const stale = fxRows({ ageHours: 25 });
    try {
      resolveRate("USD", "NGN", stale, now);
      throw new Error("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(PricingError);
      expect((error as PricingError).code).toBe("FX_STALE");
      expect((error as PricingError).message).toContain("USD to NGN");
    }
  });
  it("accepts a rate just inside 24 hours", () => {
    expect(() => resolveRate("USD", "NGN", fxRows({ ageHours: 23.9 }), now)).not.toThrow();
  });
  it("checks both legs of a derived pair", () => {
    const rows = fxRows();
    rows[1] = { ...rows[1], fetchedAt: new Date(now.getTime() - 30 * 3_600_000).toISOString() }; // CNY is stale
    expect(() => resolveRate("CNY", "NGN", rows, now)).toThrow(/CNY/);
    expect(() => resolveRate("USD", "NGN", rows, now)).not.toThrow();
  });
  it("throws FX_MISSING for a currency with no rate at all", () => {
    try {
      resolveRate("USD", "EUR", fxRows(), now);
      throw new Error("should have thrown");
    } catch (error) {
      expect((error as PricingError).code).toBe("FX_MISSING");
    }
  });
  it("ignores rates fetched after the calculation time", () => {
    const future = fxRows().map((row) => ({
      ...row,
      fetchedAt: new Date(now.getTime() + 3_600_000).toISOString(),
    }));
    expect(() => resolveRate("USD", "NGN", future, now)).toThrow(/rate/);
  });
});

describe("overrides", () => {
  const override = (quote: string, rate: string, extra: Partial<FxRow> = {}): FxRow => ({
    id: `override-${quote}`,
    base: "USD",
    quote,
    rate,
    source: "admin override",
    isOverride: true,
    endedAt: null,
    fetchedAt: new Date(now.getTime() - 3_600_000).toISOString(),
    spreadPercent: "0",
    ...extra,
  });

  it("beats the fetched rate", () => {
    const rows = [...fxRows(), override("NGN", "1600")];
    expect(convert(1000, "USD", "NGN", rows)).toBe(1_600_000);
  });
  it("lets a stale fetched rate be used while an override is open", () => {
    const rows = [...fxRows({ ageHours: 72 }), override("NGN", "1600"), override("CNY", "7")];
    expect(convert(1000, "USD", "NGN", rows)).toBe(1_600_000);
    expect(convert(700, "CNY", "USD", rows)).toBe(100);
  });
  it("stops applying once removed", () => {
    const ended = override("NGN", "1600", { endedAt: new Date(now.getTime() - 60_000).toISOString() });
    expect(convert(1000, "USD", "NGN", [...fxRows(), ended])).toBe(1_500_000);
    // ...and a stale base rate is stale again
    expect(() => convert(1000, "USD", "NGN", [...fxRows({ ageHours: 72 }), ended])).toThrow(/rate/);
  });
  it("applies to a direct pair, ahead of the derived rate", () => {
    const direct: FxRow = { ...override("NGN", "2000"), id: "direct-gbp-ngn", base: "GBP" };
    expect(convert(1000, "GBP", "NGN", [...fxRows(), direct])).toBe(2_000_000);
  });
  it("is used by a calculation: the conversion fee follows the override row", async () => {
    const { calculateLandedCost } = await import("@/lib/pricing/engine");
    const { chinaInput, rules } = await import("./pricing-fixtures");
    const withOverride = calculateLandedCost(chinaInput(), rules(), [...fxRows(), override("NGN", "1600")]);
    const without = calculateLandedCost(chinaInput(), rules(), fxRows());
    expect(withOverride.total).toBeGreaterThan(without.total);
    // The override row carries a 0 percent fee, so there is no conversion fee line.
    expect(withOverride.lines.some((l) => l.type === "fx_spread")).toBe(false);
  });
});
