/**
 * Money helpers. Amounts are whole numbers of the smallest unit (kobo, cents)
 * plus a currency code. Nothing here uses floating point for arithmetic:
 * typed amounts are read as text and split at the decimal point.
 *
 * `digits` is the number of decimal places for the currency
 * (currencies.minor_unit_digits: 2 for NGN, USD, CNY; 0 for JPY).
 */

/** Largest price a product may have, in minor units. Matches products_price_range. */
export const MAX_PRICE_MINOR = 1_000_000_000_000;

export type MoneyParseResult = { ok: true; minor: number } | { ok: false; error: string };

export type MoneyParseOptions = {
  /** Largest allowed value in minor units. Defaults to MAX_PRICE_MINOR. */
  max?: number;
  /** Accept zero. Defaults to false. */
  allowZero?: boolean;
};

// Digits with optional comma grouping in threes, optional decimal part.
const AMOUNT_PATTERN = /^(?:\d{1,3}(?:,\d{3})+|\d+)?(?:\.\d*)?$/;

function assertDigits(digits: number): void {
  if (!Number.isInteger(digits) || digits < 0 || digits > 4) {
    throw new RangeError(`Invalid number of decimal places: ${digits}`);
  }
}

/**
 * Reads an amount typed in normal units ("1,299.50") and returns minor units
 * (129950). Extra decimal places are refused instead of rounded, so a price
 * is never changed silently. Accepts ASCII digits only.
 */
export function parseMoneyInput(
  input: string,
  digits: number,
  options: MoneyParseOptions = {},
): MoneyParseResult {
  assertDigits(digits);
  const { max = MAX_PRICE_MINOR, allowZero = false } = options;

  const text = typeof input === "string" ? input.trim() : "";
  if (text === "") return { ok: false, error: "Enter an amount." };
  if (!AMOUNT_PATTERN.test(text) || !/\d/.test(text)) {
    return { ok: false, error: "Enter an amount using numbers only, for example 1299.50." };
  }

  const [whole = "", fraction = ""] = text.replaceAll(",", "").split(".");
  if (fraction.length > digits) {
    return {
      ok: false,
      error: digits === 0 ? "Enter a whole number." : `Use at most ${digits} decimal places.`,
    };
  }

  const combined = `${whole || "0"}${fraction.padEnd(digits, "0")}`.replace(/^0+(?=\d)/, "");
  // 15 digits is always below Number.MAX_SAFE_INTEGER (9,007,199,254,740,991).
  if (combined.length > 15) return { ok: false, error: "That amount is too large." };

  const minor = Number(combined);
  if (minor > max) return { ok: false, error: "That amount is too large." };
  if (minor === 0 && !allowZero) return { ok: false, error: "Enter an amount above zero." };

  return { ok: true, minor };
}

/** Minor units to a plain decimal string: (129950, 2) gives "1299.50". No grouping, no symbol. */
export function minorToDecimalString(minor: number, digits: number): string {
  assertDigits(digits);
  if (!Number.isSafeInteger(minor)) throw new RangeError(`Not a whole number of minor units: ${minor}`);

  const sign = minor < 0 ? "-" : "";
  const padded = String(Math.abs(minor)).padStart(digits + 1, "0");
  if (digits === 0) return `${sign}${padded}`;
  return `${sign}${padded.slice(0, -digits)}.${padded.slice(-digits)}`;
}

export type CurrencyFormat = { code: string; symbol: string; minor_unit_digits: number };

/**
 * Display text such as "₦15,000.00". With `withCode` the code follows, which
 * removes doubt between look-alike symbols: "¥1,299.00 CNY".
 */
export function formatMoney(
  minor: number,
  currency: CurrencyFormat,
  options: { withCode?: boolean } = {},
): string {
  const digits = currency.minor_unit_digits;
  // Safe for prices up to MAX_PRICE_MINOR: the decimal string converts exactly enough to print.
  const amount = new Intl.NumberFormat("en", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(Number(minorToDecimalString(minor, digits)));
  const text = `${currency.symbol}${amount}`;
  return options.withCode ? `${text} ${currency.code}` : text;
}
