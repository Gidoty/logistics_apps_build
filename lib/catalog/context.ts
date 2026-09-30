import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/lib/supabase/database.types";
import { currencyDigitsMap } from "@/lib/reference/queries";
import type { ProductFormContext } from "./schemas";

export type ProductFormOptions = {
  /** What the schema validates against. */
  context: ProductFormContext;
  /** Categories listings may use, grouped for a <select>. */
  categoryGroups: { name: string; categories: { slug: string; name: string }[] }[];
  currencies: Pick<Tables<"currencies">, "code" | "name" | "symbol" | "minor_unit_digits">[];
  corridors: Pick<
    Tables<"corridors">,
    "id" | "name" | "destination_country" | "default_transit_days_min" | "default_transit_days_max"
  >[];
  /** The currency of the vendor's country, when that currency is active; else NGN. */
  defaultCurrency: string;
};

/**
 * Loads what the product form and its validation need, for a vendor in
 * `vendorCountry`. Runs as the vendor, so row security applies: prohibited and
 * inactive categories are not returned, and only active corridors are.
 */
export async function loadProductFormOptions(
  supabase: SupabaseClient<Database>,
  vendorCountry: string,
): Promise<ProductFormOptions> {
  const [categories, currencies, corridors, country] = await Promise.all([
    supabase
      .from("categories")
      .select("slug, name, parent_slug, sort_order")
      .eq("active", true)
      .eq("prohibited", false)
      .order("sort_order"),
    supabase
      .from("currencies")
      .select("code, name, symbol, minor_unit_digits")
      .eq("active", true)
      .order("code"),
    supabase
      .from("corridors")
      .select("id, name, destination_country, default_transit_days_min, default_transit_days_max")
      .eq("origin_country", vendorCountry)
      .eq("active", true)
      .order("name"),
    supabase.from("countries").select("currency_code").eq("code", vendorCountry).maybeSingle(),
  ]);
  for (const result of [categories, currencies, corridors, country]) {
    if (result.error) throw new Error(`Could not load product form data: ${result.error.message}`);
  }

  const all = categories.data ?? [];
  const parents = new Set(
    all.map((category) => category.parent_slug).filter((slug): slug is string => slug !== null),
  );
  // Listings go in categories that have no sub-categories.
  const leaves = all.filter((category) => !parents.has(category.slug));

  const groups = all
    .filter((category) => category.parent_slug === null && parents.has(category.slug))
    .map((group) => ({
      name: group.name,
      categories: leaves
        .filter((leaf) => leaf.parent_slug === group.slug)
        .map((leaf) => ({ slug: leaf.slug, name: leaf.name })),
    }))
    .filter((group) => group.categories.length > 0);
  const ungrouped = leaves.filter((leaf) => leaf.parent_slug === null);
  if (ungrouped.length > 0) {
    groups.push({
      name: "Other",
      categories: ungrouped.map((leaf) => ({ slug: leaf.slug, name: leaf.name })),
    });
  }

  const activeCurrencies = currencies.data ?? [];
  const localCurrency = country.data?.currency_code;
  const defaultCurrency =
    localCurrency && activeCurrencies.some((currency) => currency.code === localCurrency)
      ? localCurrency
      : "NGN";

  return {
    context: {
      categories: leaves.map((leaf) => leaf.slug),
      currencies: currencyDigitsMap(activeCurrencies),
      corridorIds: (corridors.data ?? []).map((corridor) => corridor.id),
    },
    categoryGroups: groups,
    currencies: activeCurrencies,
    corridors: corridors.data ?? [],
    defaultCurrency,
  };
}
