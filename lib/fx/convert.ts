import { PricingError } from "@/lib/pricing/errors";
import { parseScaled, pow10, roundHalfUpDiv } from "./decimal";

/**
 * Exchange rates and conversion. Pure functions: the rows come from the
 * database (or a saved pricing snapshot) and are passed in.
 *
 * Fetched rates are stored as 1 USD = X units of a currency. Any other pair is
 * derived through USD. An admin override on a pair replaces the fetched rate;
 * a direct override on A to B beats the derived rate.
 */

export const FX_BASE_CURRENCY = "USD";
export const FX_MAX_AGE_HOURS = 24;
export const RATE_SCALE = 8;
export const SPREAD_SCALE = 4;

export type FxRow = {
  id: string;
  base: string;
  quote: string;
  /** 1 base = rate quote. A number from the database or exact text. */
  rate: string | number;
  source: string;
  isOverride: boolean;
  /** When an override was removed. */
  endedAt?: string | null;
  fetchedAt: string;
  /** Our conversion fee in percent, for buyers paying in the quote currency. */
  spreadPercent: string | number;
};

/** Multiply an amount in major units by num/den to convert. */
export type Ratio = { num: bigint; den: bigint };

export type ResolvedRate = {
  ratio: Ratio;
  /** Conversion fee as percent x 10^4. Zero when no conversion happens. */
  spreadScaled: bigint;
  /** The rows this rate came from, for the pricing snapshot. */
  rows: FxRow[];
};

const RATE_UNIT = pow10(RATE_SCALE);

function at(row: FxRow): number {
  return new Date(row.fetchedAt).getTime();
}

/** The row pricing a pair at `now`: the override that was open then, else the newest fetch before it. */
export function effectiveFxRow(rows: readonly FxRow[], base: string, quote: string, now: Date): FxRow | null {
  const time = now.getTime();
  const pair = rows.filter((row) => row.base === base && row.quote === quote && at(row) <= time);
  const overrides = pair
    .filter((row) => row.isOverride && (!row.endedAt || new Date(row.endedAt).getTime() > time))
    .sort((a, b) => at(b) - at(a));
  if (overrides[0]) return overrides[0];
  const fetched = pair.filter((row) => !row.isOverride).sort((a, b) => at(b) - at(a));
  return fetched[0] ?? null;
}

/** Throws FX_STALE for a fetched rate older than the limit. Overrides never go stale. */
function assertFresh(row: FxRow, now: Date, maxAgeHours: number): void {
  if (row.isOverride) return;
  const ageMs = now.getTime() - at(row);
  if (ageMs > maxAgeHours * 3_600_000) {
    throw new PricingError(
      "FX_STALE",
      `The ${row.base} to ${row.quote} exchange rate is ${Math.floor(ageMs / 3_600_000)} hours old (limit ${maxAgeHours}). ` +
        "Fetch new rates or set an override in Admin > Pricing > FX rates.",
      { base: row.base, quote: row.quote, fetchedAt: row.fetchedAt },
    );
  }
}

function usdLeg(rows: readonly FxRow[], currency: string, now: Date, maxAgeHours: number): FxRow {
  const row = effectiveFxRow(rows, FX_BASE_CURRENCY, currency, now);
  if (!row) {
    throw new PricingError(
      "FX_MISSING",
      `There is no ${FX_BASE_CURRENCY} to ${currency} exchange rate yet. Fetch rates in Admin > Pricing > FX rates.`,
      { base: FX_BASE_CURRENCY, quote: currency },
    );
  }
  assertFresh(row, now, maxAgeHours);
  return row;
}

export function resolveRate(
  from: string,
  to: string,
  rows: readonly FxRow[],
  now: Date,
  maxAgeHours: number = FX_MAX_AGE_HOURS,
): ResolvedRate {
  if (from === to) return { ratio: { num: 1n, den: 1n }, spreadScaled: 0n, rows: [] };

  const direct = effectiveFxRow(rows, from, to, now);
  if (direct?.isOverride) {
    return {
      ratio: { num: parseScaled(direct.rate, RATE_SCALE, "rate"), den: RATE_UNIT },
      spreadScaled: parseScaled(direct.spreadPercent, SPREAD_SCALE, "spread"),
      rows: [direct],
    };
  }

  const fromLeg = from === FX_BASE_CURRENCY ? null : usdLeg(rows, from, now, maxAgeHours);
  const toLeg = to === FX_BASE_CURRENCY ? null : usdLeg(rows, to, now, maxAgeHours);
  const rateFrom = fromLeg ? parseScaled(fromLeg.rate, RATE_SCALE, "rate") : RATE_UNIT;
  const rateTo = toLeg ? parseScaled(toLeg.rate, RATE_SCALE, "rate") : RATE_UNIT;
  if (rateFrom <= 0n || rateTo <= 0n) {
    throw new PricingError("FX_MISSING", `The exchange rate for ${from} to ${to} is not usable`, {
      from,
      to,
    });
  }
  // The conversion fee is the one set on the buyer-currency side of the trade.
  const feeRow = toLeg ?? fromLeg;
  return {
    ratio: { num: rateTo, den: rateFrom },
    spreadScaled: feeRow ? parseScaled(feeRow.spreadPercent, SPREAD_SCALE, "spread") : 0n,
    rows: [fromLeg, toLeg].filter((row): row is FxRow => row !== null),
  };
}

/** Converts minor units between currencies, adjusting for each currency's decimals. Rounds half up. */
export function convertMinor(
  amountMinor: bigint,
  fromDigits: number,
  toDigits: number,
  ratio: Ratio,
): bigint {
  return roundHalfUpDiv(amountMinor * ratio.num * pow10(toDigits), ratio.den * pow10(fromDigits));
}
