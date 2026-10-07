import { minorToDecimalString } from "@/lib/money";
import type { LandedCost, PricingSnapshot, PricingWarning } from "./types";

/** A calculation as the browser sees it: amounts as plain decimal text, ready to edit. */
export type CalcView = {
  currency: string;
  totalMinor: number;
  lines: {
    /** The engine line this row came from. The same key ties it back on send. */
    calcType: string;
    label: string;
    amountMinor: number;
    amount: string;
    estimated: boolean;
  }[];
  warnings: PricingWarning[];
  customsDisclaimer: string | null;
  chargeableWeightGrams: number;
  weightBasis: "actual" | "volumetric";
  snapshot: PricingSnapshot;
};

export function toCalcView(result: LandedCost, currencyDigits: number): CalcView {
  return {
    currency: result.currency,
    totalMinor: result.total,
    lines: result.lines.map((line) => ({
      calcType: line.type,
      label: line.label,
      amountMinor: line.amountMinor,
      amount: minorToDecimalString(line.amountMinor, currencyDigits),
      estimated: line.estimated,
    })),
    warnings: result.warnings,
    customsDisclaimer: result.customsDisclaimer,
    chargeableWeightGrams: result.chargeableWeightGrams,
    weightBasis: result.weightBasis,
    snapshot: result.snapshot,
  };
}
