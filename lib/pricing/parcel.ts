import { MAX_WEIGHT_GRAMS } from "./input";

/**
 * The parcel for an order of several identical items: the weights add up. The
 * box size is only known for one item, so it is used for a single item and
 * left out for more (the engine then warns that it used actual weight).
 */
export function parcelFor(
  unitWeightGrams: number,
  unitBoxCm: { length: number; width: number; height: number } | null,
  quantity: number,
): { weightGrams: number; dimensionsCm: { length: number; width: number; height: number } | null } {
  return {
    weightGrams: Math.min(unitWeightGrams * quantity, MAX_WEIGHT_GRAMS),
    dimensionsCm: quantity === 1 ? unitBoxCm : null,
  };
}
