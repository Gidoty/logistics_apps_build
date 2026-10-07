/**
 * What the platform earns on a quote, for the admin only: the service fee and
 * the currency conversion fee as calculated, plus whatever the admin added or
 * changed by hand. Payment processing is not revenue: it is a cost passed on.
 */
export type MarginLine = {
  type: string;
  amountMinor: number;
  /** Present when the admin changed or added the line. Null original = a manual line. */
  override: { originalAmountMinor: number | null } | null;
};

export type Margin = {
  serviceFeeMinor: number;
  fxSpreadMinor: number;
  /** Final minus calculated, summed over changed lines; the full amount for manual lines. */
  overrideUpliftMinor: number;
  revenueMinor: number;
};

export function computeMargin(lines: readonly MarginLine[]): Margin {
  let serviceFee = 0;
  let fxSpread = 0;
  let uplift = 0;
  for (const line of lines) {
    const calculated = line.override ? (line.override.originalAmountMinor ?? 0) : line.amountMinor;
    if (line.type === "service_fee") serviceFee += calculated;
    if (line.type === "fx_spread") fxSpread += calculated;
    if (line.override) uplift += line.amountMinor - calculated;
  }
  return {
    serviceFeeMinor: serviceFee,
    fxSpreadMinor: fxSpread,
    overrideUpliftMinor: uplift,
    revenueMinor: serviceFee + fxSpread + uplift,
  };
}
