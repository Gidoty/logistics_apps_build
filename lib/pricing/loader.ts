import "server-only";
import { unstable_cache } from "next/cache";
import type { FxRow } from "@/lib/fx/convert";
import type { Tables } from "@/lib/supabase/database.types";
import { createServiceClient } from "@/lib/supabase/service";
import { PRICING_CACHE_TAG } from "./cache-tags";
import type { DeliveryZone, DutyRate, FeeRule, PricingCorridor, PricingRules } from "./types";

/**
 * Loads rules and rates for the pricing engine. This is the only place the
 * engine's data comes from, and it uses the service role on the server: the
 * rule tables are admin-only, and what leaves the server is a computed price,
 * never the rules themselves.
 */

export function mapFeeRule(row: Tables<"fee_rules">): FeeRule {
  return {
    id: row.id,
    corridorId: row.corridor_id,
    feeType: row.fee_type,
    calcMethod: row.calc_method,
    value: row.value,
    currency: row.currency,
    minAmountMinor: row.min_amount_minor,
    maxAmountMinor: row.max_amount_minor,
    weightFromG: row.weight_from_g,
    weightToG: row.weight_to_g,
    categorySlug: row.category_slug,
    zoneId: row.zone_id,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
  };
}

export function mapDutyRate(row: Tables<"duty_rates">): DutyRate {
  return {
    id: row.id,
    corridorId: row.corridor_id,
    categorySlug: row.category_slug,
    importDutyPercent: row.import_duty_percent,
    vatPercent: row.vat_percent,
    otherLeviesPercent: row.other_levies_percent,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
  };
}

export function mapZone(row: Tables<"delivery_zones">): DeliveryZone {
  return { id: row.id, name: row.name, states: row.states };
}

export function mapFxRow(row: Tables<"fx_rates">): FxRow {
  return {
    id: row.id,
    base: row.base_currency,
    quote: row.quote_currency,
    rate: row.rate,
    source: row.source,
    isOverride: row.is_override,
    endedAt: row.ended_at,
    fetchedAt: row.fetched_at,
    spreadPercent: row.spread_percent,
  };
}

/** Rules in force now or later (closed rules are history). Always reads the database. */
export async function loadPricingRulesFresh(): Promise<PricingRules> {
  const db = createServiceClient();
  const nowIso = new Date().toISOString();
  const [fees, duties, zones, categories, currencies] = await Promise.all([
    db.from("fee_rules").select("*").or(`effective_to.is.null,effective_to.gt.${nowIso}`),
    db.from("duty_rates").select("*").or(`effective_to.is.null,effective_to.gt.${nowIso}`),
    db.from("delivery_zones").select("*"),
    db.from("categories").select("slug, parent_slug"),
    db.from("currencies").select("code, minor_unit_digits").eq("active", true),
  ]);
  for (const result of [fees, duties, zones, categories, currencies]) {
    if (result.error) throw new Error(`Could not load pricing rules: ${result.error.message}`);
  }
  return {
    feeRules: (fees.data ?? []).map(mapFeeRule),
    dutyRates: (duties.data ?? []).map(mapDutyRate),
    zones: (zones.data ?? []).map(mapZone),
    categories: (categories.data ?? []).map((row) => ({ slug: row.slug, parentSlug: row.parent_slug })),
    currencies: (currencies.data ?? []).map((row) => ({
      code: row.code,
      minorUnitDigits: row.minor_unit_digits,
    })),
  };
}

/** The same rules, kept for an hour. Cleared by the pricing tag when a rule or rate changes. */
export const loadPricingRules = unstable_cache(loadPricingRulesFresh, ["pricing-rules"], {
  tags: [PRICING_CACHE_TAG],
  revalidate: 3600,
});

/** The newest exchange rows plus every open override. Never cached: staleness must show at once. */
export async function loadFxRows(): Promise<FxRow[]> {
  const db = createServiceClient();
  const [recent, overrides] = await Promise.all([
    db.from("fx_rates").select("*").order("fetched_at", { ascending: false }).limit(300),
    db.from("fx_rates").select("*").eq("is_override", true).is("ended_at", null),
  ]);
  if (recent.error) throw new Error(`Could not load exchange rates: ${recent.error.message}`);
  if (overrides.error) throw new Error(`Could not load exchange rates: ${overrides.error.message}`);
  const byId = new Map<string, Tables<"fx_rates">>();
  for (const row of [...recent.data, ...overrides.data]) byId.set(row.id, row);
  return [...byId.values()].map(mapFxRow);
}

export async function loadCorridor(id: string): Promise<PricingCorridor | null> {
  const { data, error } = await createServiceClient()
    .from("corridors")
    .select("id, name, origin_country, destination_country")
    .eq("id", id)
    .eq("active", true)
    .maybeSingle();
  if (error) throw new Error(`Could not load the route: ${error.message}`);
  return data
    ? {
        id: data.id,
        name: data.name,
        originCountry: data.origin_country,
        destinationCountry: data.destination_country,
      }
    : null;
}
