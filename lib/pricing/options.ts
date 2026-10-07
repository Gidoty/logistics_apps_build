import "server-only";
import { createPublicClient } from "@/lib/supabase/public";
import { currencyDigitsMap } from "@/lib/reference/queries";
import type { CalcRequestContext } from "./input";

export type CalcOptions = {
  context: CalcRequestContext;
  categoryGroups: { name: string; categories: { slug: string; name: string }[] }[];
  currencies: { code: string; name: string; symbol: string; minor_unit_digits: number }[];
  corridors: { id: string; name: string; origin_country: string; destination_country: string }[];
  states: string[];
};

/**
 * Everything a price form offers and validates against. All of it is public
 * reference data, so it is read as a visitor: the same lists serve the public
 * estimator and the admin tools.
 */
export async function loadCalcOptions(): Promise<CalcOptions> {
  const db = createPublicClient();
  const [categories, currencies, corridors, regions] = await Promise.all([
    db
      .from("categories")
      .select("slug, name, parent_slug, sort_order")
      .eq("active", true)
      .eq("prohibited", false)
      .order("sort_order"),
    db.from("currencies").select("code, name, symbol, minor_unit_digits").eq("active", true).order("code"),
    db
      .from("corridors")
      .select("id, name, origin_country, destination_country")
      .eq("active", true)
      .order("name"),
    db.from("regions").select("name").eq("country_code", "NG").order("name"),
  ]);
  for (const result of [categories, currencies, corridors, regions]) {
    if (result.error) throw new Error(`Could not load price options: ${result.error.message}`);
  }

  const all = categories.data ?? [];
  const parents = new Set(all.map((c) => c.parent_slug).filter((slug): slug is string => slug !== null));
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

  return {
    context: {
      currencies: currencyDigitsMap(currencies.data ?? []),
      categorySlugs: leaves.map((leaf) => leaf.slug),
      corridorIds: (corridors.data ?? []).map((corridor) => corridor.id),
      states: (regions.data ?? []).map((region) => region.name),
    },
    categoryGroups: groups,
    currencies: currencies.data ?? [],
    corridors: corridors.data ?? [],
    states: (regions.data ?? []).map((region) => region.name),
  };
}
