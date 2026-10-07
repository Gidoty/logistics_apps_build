import { calculateLandedCost } from "./engine";
import type { LandedCost, PricingSnapshot } from "./types";

/**
 * Recalculates a saved quote from its own snapshot: the inputs, and a copy of
 * every rule, duty rate, zone and exchange rate the original calculation used.
 * Nothing is read from the live tables, so the result is the same whatever the
 * rates have done since.
 */
export function replaySnapshot(snapshot: PricingSnapshot): LandedCost {
  const { input, data } = snapshot;
  return calculateLandedCost(
    input,
    {
      feeRules: data.feeRules,
      dutyRates: data.dutyRates,
      zones: data.zones,
      categories: data.categories,
      currencies: data.currencies,
    },
    data.fxRows,
  );
}

/** True when replaying the snapshot gives exactly the lines and total it recorded. */
export function snapshotReproduces(snapshot: PricingSnapshot): boolean {
  const replayed = replaySnapshot(snapshot);
  const recorded = snapshot.output;
  return (
    replayed.total === recorded.total &&
    replayed.currency === recorded.currency &&
    replayed.lines.length === recorded.lines.length &&
    replayed.lines.every((line, index) => {
      const original = recorded.lines[index];
      return (
        line.type === original.type &&
        line.label === original.label &&
        line.amountMinor === original.amountMinor
      );
    })
  );
}
