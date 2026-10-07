import { PricingError } from "@/lib/pricing/errors";

/**
 * Exact decimal arithmetic on BigInt. Money and rates are never JavaScript
 * floats here: a rate such as 1650.12345678 is held as the integer
 * 165012345678 with a scale of 8.
 */

export function pow10(exponent: number): bigint {
  if (!Number.isInteger(exponent) || exponent < 0 || exponent > 30) {
    throw new PricingError("INVALID_INPUT", `Unsupported number of decimal places: ${exponent}`);
  }
  return 10n ** BigInt(exponent);
}

/** n / d rounded half up. Only for n >= 0 and d > 0, which every amount here is. */
export function roundHalfUpDiv(n: bigint, d: bigint): bigint {
  if (d <= 0n || n < 0n) throw new PricingError("INVALID_INPUT", "Cannot divide these amounts");
  return (2n * n + d) / (2n * d);
}

/**
 * Reads a non-negative decimal (text, or a number from a JSON/database
 * response) as an integer multiplied by 10^scale. Digits beyond the scale are
 * rounded half up.
 */
export function parseScaled(value: string | number, scale: number, label = "value"): bigint {
  let text: string;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) {
      throw new PricingError("INVALID_INPUT", `${label} must be a number of zero or more`);
    }
    // toFixed gives the exact decimal expansion the double rounds to, to the scale asked.
    text = value.toFixed(Math.min(scale + 2, 100));
  } else {
    text = value.trim();
  }
  if (!/^\d+(\.\d+)?$/.test(text)) {
    throw new PricingError("INVALID_INPUT", `${label} must be a number of zero or more`);
  }
  const [whole, fraction = ""] = text.split(".");
  let result = BigInt(whole + fraction.slice(0, scale).padEnd(scale, "0"));
  if (fraction.length > scale && fraction[scale] >= "5") result += 1n;
  return result;
}

/** A BigInt amount as a safe JavaScript integer, or an error when it would lose precision. */
export function toSafeNumber(value: bigint, label = "amount"): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < 0n) {
    throw new PricingError("INVALID_INPUT", `The ${label} is too large to calculate`);
  }
  return Number(value);
}
