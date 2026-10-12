import { convertMinor, resolveRate } from "@/lib/fx/convert";
import { PricingError } from "@/lib/pricing/errors";
import type { PricingSnapshot } from "@/lib/pricing/types";

export const CHARGE_CURRENCY = "NGN";

export type NgnCharge = {
  /** Kobo to charge. */
  amountMinor: number;
  /** How it was worked out, saved on the payment so it can be checked later. */
  note: {
    method: "same_currency" | "snapshot_rates";
    quoteCurrency: string;
    quoteTotalMinor: number;
    rateNum?: string;
    rateDen?: string;
    fxRowIds?: string[];
    snapshotAt?: string;
  };
};

/**
 * The naira amount for a quote: the quote's total (overrides included) at the
 * exchange rates frozen in its pricing snapshot, rounded half up, with no
 * extra fee. The buyer pays the price they accepted, and anyone can redo this
 * sum from the snapshot later.
 */
export function quoteTotalInNgn(
  quoteTotalMinor: number,
  quoteCurrency: string,
  snapshot: PricingSnapshot | null,
): NgnCharge {
  if (quoteCurrency === CHARGE_CURRENCY) {
    return {
      amountMinor: quoteTotalMinor,
      note: { method: "same_currency", quoteCurrency, quoteTotalMinor },
    };
  }
  if (!snapshot)
    throw new PricingError(
      "INVALID_INPUT",
      "This quote has no pricing snapshot, so it cannot be charged in naira",
    );
  const digits = (code: string) => snapshot.data.currencies.find((c) => c.code === code)?.minorUnitDigits;
  const from = digits(quoteCurrency);
  const to = digits(CHARGE_CURRENCY);
  if (from === undefined || to === undefined) {
    throw new PricingError(
      "INVALID_INPUT",
      "The quote's snapshot is missing a currency, so it cannot be charged in naira",
    );
  }
  // As of when the quote was calculated, so the rates are the ones the buyer's price was built on.
  const resolved = resolveRate(
    quoteCurrency,
    CHARGE_CURRENCY,
    snapshot.data.fxRows,
    new Date(snapshot.input.now),
  );
  const amount = convertMinor(BigInt(quoteTotalMinor), from, to, resolved.ratio);
  if (amount <= 0n || amount > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new PricingError("INVALID_INPUT", "The naira amount is not valid");
  }
  return {
    amountMinor: Number(amount),
    note: {
      method: "snapshot_rates",
      quoteCurrency,
      quoteTotalMinor,
      rateNum: resolved.ratio.num.toString(),
      rateDen: resolved.ratio.den.toString(),
      fxRowIds: resolved.rows.map((row) => row.id),
      snapshotAt: snapshot.input.now,
    },
  };
}
