import { z } from "zod";
import { parseMoneyInput } from "@/lib/money";
import { fieldErrorsFromIssues, MAX_DIMENSION_CM, optionalDimensionCm, wholeNumber } from "@/lib/validation";

export { fieldErrorsFromIssues };

export const MAX_WEIGHT_GRAMS = 500_000;
export { MAX_DIMENSION_CM };

/** What a price request is checked against. All lists come from the database. */
export type CalcRequestContext = {
  /** Active currencies and their decimal places. */
  currencies: Readonly<Record<string, number>>;
  categorySlugs: readonly string[];
  corridorIds: readonly string[];
  states: readonly string[];
};

export type CalcRequest = {
  itemUnitPriceMinor: number;
  itemCurrency: string;
  quantity: number;
  actualWeightGrams: number;
  dimensionsCm: { length: number; width: number; height: number } | null;
  categorySlug: string;
  corridorId: string;
  destinationState: string;
  buyerCurrency: string;
  specialHandling: boolean;
};

/**
 * Item, weight, route and destination for a landed-cost calculation. Shared by
 * the public estimator, the admin quote builder and the admin test panel, so
 * all three accept exactly the same things.
 */
export function createCalcRequestSchema(context: CalcRequestContext) {
  return z
    .object({
      itemPrice: z.string().default(""),
      itemCurrency: z.string().trim().toUpperCase(),
      quantity: wholeNumber("Quantity", 1, 1000),
      weightGrams: wholeNumber("Weight", 1, MAX_WEIGHT_GRAMS),
      length: optionalDimensionCm("Length"),
      width: optionalDimensionCm("Width"),
      height: optionalDimensionCm("Height"),
      categorySlug: z.string().trim(),
      corridorId: z.string().trim(),
      destinationState: z.string().trim(),
      buyerCurrency: z.string().trim().toUpperCase(),
      specialHandling: z.boolean().default(false),
    })
    .transform((data, ctx): CalcRequest => {
      const fail = (path: string, message: string) => ctx.addIssue({ code: "custom", path: [path], message });

      if (!Object.hasOwn(context.currencies, data.itemCurrency))
        fail("itemCurrency", "Choose the item's currency.");
      if (!Object.hasOwn(context.currencies, data.buyerCurrency)) fail("buyerCurrency", "Choose a currency.");
      if (!context.categorySlugs.includes(data.categorySlug)) fail("categorySlug", "Choose a category.");
      if (!context.corridorIds.includes(data.corridorId))
        fail("corridorId", "Choose where the item ships from.");
      if (!context.states.includes(data.destinationState)) fail("destinationState", "Choose a state.");

      let itemUnitPriceMinor = 0;
      const digits = context.currencies[data.itemCurrency];
      if (digits !== undefined) {
        const price = parseMoneyInput(data.itemPrice, digits);
        if (price.ok) itemUnitPriceMinor = price.minor;
        else fail("itemPrice", price.error);
      }

      const sizes = [data.length, data.width, data.height];
      const given = sizes.filter((value) => value !== null).length;
      if (given !== 0 && given !== 3) fail("length", "Give all three sizes (length, width, height) or none.");

      return {
        itemUnitPriceMinor,
        itemCurrency: data.itemCurrency,
        quantity: data.quantity,
        actualWeightGrams: data.weightGrams,
        dimensionsCm:
          given === 3
            ? { length: data.length as number, width: data.width as number, height: data.height as number }
            : null,
        categorySlug: data.categorySlug,
        corridorId: data.corridorId,
        destinationState: data.destinationState,
        buyerCurrency: data.buyerCurrency,
        specialHandling: data.specialHandling,
      };
    });
}
