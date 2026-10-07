/** One tag for everything priced from rules and rates: rule changes and new FX rates clear it. */
export const PRICING_CACHE_TAG = "pricing";

export function productEstimateTag(productId: string): string {
  return `estimate-product-${productId}`;
}
