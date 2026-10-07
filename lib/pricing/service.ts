import "server-only";
import { calculateLandedCost } from "./engine";
import { PricingError } from "./errors";
import { loadCorridor, loadFxRows, loadPricingRules, loadPricingRulesFresh } from "./loader";
import type { CalcRequest } from "./input";
import type { LandedCost, PricingInput } from "./types";

/**
 * Runs the engine on live data. `fresh: true` reads the rules straight from the
 * database (admin tools); otherwise the hour-long cached rules are used
 * (public estimator). Exchange rates are always read fresh, so a stale rate
 * stops a calculation at once. Throws PricingError.
 */
export async function calculateFromRequest(
  request: CalcRequest,
  options: { fresh?: boolean; now?: Date } = {},
): Promise<LandedCost> {
  const corridor = await loadCorridor(request.corridorId);
  if (!corridor) throw new PricingError("INVALID_INPUT", "That shipping route is not available");
  const [rules, fxRows] = await Promise.all([
    options.fresh ? loadPricingRulesFresh() : loadPricingRules(),
    loadFxRows(),
  ]);
  const input: PricingInput = {
    now: (options.now ?? new Date()).toISOString(),
    itemUnitPriceMinor: request.itemUnitPriceMinor,
    itemCurrency: request.itemCurrency,
    quantity: request.quantity,
    actualWeightGrams: request.actualWeightGrams,
    dimensionsCm: request.dimensionsCm,
    categorySlug: request.categorySlug,
    corridor,
    destinationState: request.destinationState,
    buyerCurrency: request.buyerCurrency,
    specialHandling: request.specialHandling,
  };
  return calculateLandedCost(input, rules, fxRows);
}
