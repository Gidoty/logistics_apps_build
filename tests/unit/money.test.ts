import { describe, expect, it } from "vitest";
import { formatMoney, MAX_PRICE_MINOR, minorToDecimalString, parseMoneyInput } from "@/lib/money";

const minor = (input: string, digits = 2, options = {}) => {
  const result = parseMoneyInput(input, digits, options);
  if (!result.ok) throw new Error(result.error);
  return result.minor;
};
const error = (input: string, digits = 2, options = {}) => {
  const result = parseMoneyInput(input, digits, options);
  if (result.ok) throw new Error(`expected an error for "${input}", got ${result.minor}`);
  return result.error;
};

describe("parseMoneyInput: normal units to minor units", () => {
  it.each([
    // NGN, USD and CNY all use 2 decimal places
    ["NGN", "15000", 1_500_000],
    ["NGN", "15,000.00", 1_500_000],
    ["NGN", "0.50", 50],
    ["USD", "19.99", 1999],
    ["USD", "1,299.5", 129_950],
    ["CNY", "4999", 499_900],
    ["CNY", "0.01", 1],
  ])("%s %s", (_currency, input, expected) => {
    expect(minor(input)).toBe(expected);
  });

  it("accepts the ways people type amounts", () => {
    expect(minor("  25  ")).toBe(2500);
    expect(minor(".5")).toBe(50);
    expect(minor("5.")).toBe(500);
    expect(minor("007")).toBe(700);
    expect(minor("1,000")).toBe(100_000);
    expect(minor("1,234,567.89")).toBe(123_456_789);
  });

  it("works for currencies with other decimal places", () => {
    expect(minor("1500", 0)).toBe(1500);
    expect(minor("1.234", 3)).toBe(1234);
    expect(minor("2", 3)).toBe(2000);
  });
});

describe("parseMoneyInput: rounding edge cases", () => {
  it("never rounds: extra decimal places are refused", () => {
    expect(error("19.999")).toBe("Use at most 2 decimal places.");
    expect(error("1.005")).toBe("Use at most 2 decimal places.");
    expect(error("0.001")).toBe("Use at most 2 decimal places.");
    expect(error("10.50", 0)).toBe("Enter a whole number.");
    expect(error("1.2345", 3)).toBe("Use at most 3 decimal places.");
  });

  it("treats trailing zeros as fine: they are not extra precision to round", () => {
    expect(minor("19.90")).toBe(1990);
    expect(error("19.900")).toBe("Use at most 2 decimal places.");
  });

  it("is exact where floating point is not", () => {
    // 0.1 + 0.2 = 0.30000000000000004 and 1.15 * 100 = 114.99999999999999 as floats.
    expect(minor("0.30")).toBe(30);
    expect(minor("1.15")).toBe(115);
    expect(minor("4.35")).toBe(435);
    expect(minor("8.2")).toBe(820);
  });
});

describe("parseMoneyInput: bad input", () => {
  it.each([
    "",
    "   ",
    "abc",
    "1e3",
    "-5",
    "+5",
    "1.2.3",
    "1,23",
    "12,34.56",
    "1 000",
    "₦500",
    "$5",
    "٣٤",
    "１２３",
    ".",
  ])('rejects "%s"', (input) => {
    expect(parseMoneyInput(input, 2).ok).toBe(false);
  });

  it("rejects zero unless allowed", () => {
    expect(error("0")).toBe("Enter an amount above zero.");
    expect(error("0.00")).toBe("Enter an amount above zero.");
    expect(minor("0", 2, { allowZero: true })).toBe(0);
  });

  it("enforces the price cap and stays inside safe integers", () => {
    expect(minor("10000000000.00")).toBe(MAX_PRICE_MINOR);
    expect(error("10000000000.01")).toBe("That amount is too large.");
    expect(error("99999999999999999999")).toBe("That amount is too large.");
    expect(error("90071992547409.93")).toBe("That amount is too large.");
    expect(minor("500", 2, { max: 100_000 })).toBe(50_000);
    expect(error("1001", 2, { max: 100_000 })).toBe("That amount is too large.");
  });

  it("rejects an invalid number of decimal places as a programming error", () => {
    expect(() => parseMoneyInput("5", -1)).toThrow(RangeError);
    expect(() => parseMoneyInput("5", 2.5)).toThrow(RangeError);
    expect(() => parseMoneyInput("5", 9)).toThrow(RangeError);
  });
});

describe("minorToDecimalString: minor units back to normal units", () => {
  it.each([
    [129_950, 2, "1299.50"],
    [1, 2, "0.01"],
    [0, 2, "0.00"],
    [100, 2, "1.00"],
    [1_500_000, 2, "15000.00"],
    [1500, 0, "1500"],
    [1234, 3, "1.234"],
    [5, 3, "0.005"],
    [-250, 2, "-2.50"],
  ])("%d with %d digits is %s", (value, digits, expected) => {
    expect(minorToDecimalString(value, digits)).toBe(expected);
  });

  it("round-trips every tested currency", () => {
    for (const value of [1, 9, 10, 99, 100, 101, 1999, 123_456_789, MAX_PRICE_MINOR]) {
      expect(minor(minorToDecimalString(value, 2))).toBe(value);
    }
    for (const value of [1, 1000, 123_456]) {
      expect(minor(minorToDecimalString(value, 3), 3)).toBe(value);
    }
  });

  it("refuses values that are not whole numbers of minor units", () => {
    expect(() => minorToDecimalString(1.5, 2)).toThrow(RangeError);
    expect(() => minorToDecimalString(Number.NaN, 2)).toThrow(RangeError);
    expect(() => minorToDecimalString(2 ** 60, 2)).toThrow(RangeError);
  });
});

describe("formatMoney", () => {
  const ngn = { code: "NGN", symbol: "₦", minor_unit_digits: 2 };
  const cny = { code: "CNY", symbol: "¥", minor_unit_digits: 2 };
  const usd = { code: "USD", symbol: "$", minor_unit_digits: 2 };
  const jpy = { code: "JPY", symbol: "¥", minor_unit_digits: 0 };

  it("formats with symbol, grouping and the currency's decimals", () => {
    expect(formatMoney(1_500_000, ngn)).toBe("₦15,000.00");
    expect(formatMoney(129_950, usd)).toBe("$1,299.50");
    expect(formatMoney(5, cny)).toBe("¥0.05");
    expect(formatMoney(1500, jpy)).toBe("¥1,500");
  });

  it("can add the currency code to tell look-alike symbols apart", () => {
    expect(formatMoney(499_900, cny, { withCode: true })).toBe("¥4,999.00 CNY");
  });

  it("prints the largest allowed price exactly", () => {
    expect(formatMoney(MAX_PRICE_MINOR, ngn)).toBe("₦10,000,000,000.00");
  });
});
