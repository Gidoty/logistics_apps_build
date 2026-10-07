import "server-only";
import { unstable_cache } from "next/cache";
import { cache } from "react";
import { resolveRate, FX_BASE_CURRENCY } from "@/lib/fx/convert";
import { createPublicClient } from "@/lib/supabase/public";
import { productEstimateTag, PRICING_CACHE_TAG } from "./cache-tags";
import { calculateLandedCost } from "./engine";
import { isPricingError, PricingError } from "./errors";
import { loadCorridor, loadFxRows, loadPricingRules } from "./loader";
import { findZone } from "./rules";

/** The state an estimate is for until the visitor picks one. */
export const DEFAULT_ESTIMATE_STATE = "Lagos";

export type ShopEstimate =
  | { ok: true; totalMinor: number; currency: string; zoneName: string; hasCustomsEstimate: boolean }
  | { ok: false };

type Cached =
  | {
      kind: "price";
      totalMinor: number;
      currency: string;
      zoneName: string;
      hasCustomsEstimate: boolean;
      /** Currencies whose rates the price depends on, checked for freshness on every read. */
      currenciesUsed: string[];
    }
  | { kind: "unavailable" };

/**
 * Prices a listed product for one destination. Cached for an hour per product,
 * currency and delivery zone; the cache is cleared when the product or any
 * rule or rate changes. Failures (a missing rule, a stale rate) are thrown so
 * they are never cached.
 */
async function computeEstimate(productId: string, currency: string, state: string): Promise<Cached> {
  const { data: product, error } = await createPublicClient()
    .from("products")
    .select(
      "price_minor, currency, weight_grams, length_cm, width_cm, height_cm, category, corridor_id, requires_special_handling",
    )
    .eq("id", productId)
    .maybeSingle();
  if (error) throw new Error(`Could not load the product: ${error.message}`);
  // No weight, no delivered price. Stable until the product changes, so it may be cached.
  if (!product || product.weight_grams === null) return { kind: "unavailable" };

  const corridor = await loadCorridor(product.corridor_id);
  if (!corridor) return { kind: "unavailable" };
  const [rules, fxRows] = await Promise.all([loadPricingRules(), loadFxRows()]);
  const hasBox = product.length_cm !== null && product.width_cm !== null && product.height_cm !== null;

  const result = calculateLandedCost(
    {
      now: new Date().toISOString(),
      itemUnitPriceMinor: product.price_minor,
      itemCurrency: product.currency,
      quantity: 1,
      actualWeightGrams: product.weight_grams,
      dimensionsCm: hasBox
        ? {
            length: Number(product.length_cm),
            width: Number(product.width_cm),
            height: Number(product.height_cm),
          }
        : null,
      categorySlug: product.category,
      corridor,
      destinationState: state,
      buyerCurrency: currency,
      specialHandling: product.requires_special_handling,
    },
    rules,
    fxRows,
  );
  const zone = findZone(rules.zones, state);
  return {
    kind: "price",
    totalMinor: result.total,
    currency: result.currency,
    zoneName: zone?.name ?? "",
    hasCustomsEstimate: result.customsDisclaimer !== null,
    currenciesUsed: result.snapshot.data.currencies.map((currency) => currency.code),
  };
}

/** Exchange rows for this request, shared by every product on the page. */
const requestFxRows = cache(loadFxRows);

/** True when every rate a cached price depends on is still fresh (or overridden) right now. */
async function ratesStillFresh(currenciesUsed: string[]): Promise<boolean> {
  const rows = await requestFxRows();
  const now = new Date();
  try {
    for (const code of currenciesUsed) {
      if (code !== FX_BASE_CURRENCY) resolveRate(FX_BASE_CURRENCY, code, rows, now);
    }
    return true;
  } catch (error) {
    if (isPricingError(error)) return false;
    throw error;
  }
}

/**
 * "Est. delivered" for a product, or { ok: false } when the page should say
 * "Delivered price on request". Never returns a wrong number: any pricing
 * error, an unknown state, or a stale rate gives { ok: false }.
 */
export async function getProductEstimate(
  productId: string,
  currency: string,
  state: string = DEFAULT_ESTIMATE_STATE,
): Promise<ShopEstimate> {
  try {
    const rules = await loadPricingRules();
    const zone = findZone(rules.zones, state);
    if (!zone) return { ok: false };

    const cached = await unstable_cache(
      () => computeEstimate(productId, currency, state),
      ["product-estimate", productId, currency, zone.id],
      { tags: [PRICING_CACHE_TAG, productEstimateTag(productId)], revalidate: 3600 },
    )();
    if (cached.kind !== "price") return { ok: false };
    if (!(await ratesStillFresh(cached.currenciesUsed))) return { ok: false };
    return {
      ok: true,
      totalMinor: cached.totalMinor,
      currency: cached.currency,
      zoneName: cached.zoneName,
      hasCustomsEstimate: cached.hasCustomsEstimate,
    };
  } catch (error) {
    // Rules or rates are not in a state to price this. A page must still render.
    if (!(error instanceof PricingError)) console.error("Product estimate failed", productId, error);
    return { ok: false };
  }
}

/** Estimates for a page of products, keyed by product id. */
export async function estimateProducts(
  products: readonly { id: string }[],
  currency: string,
): Promise<Record<string, ShopEstimate>> {
  const list = await Promise.all(products.map((product) => getProductEstimate(product.id, currency)));
  return Object.fromEntries(products.map((product, index) => [product.id, list[index]]));
}
