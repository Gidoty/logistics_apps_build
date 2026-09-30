import "server-only";
import { cache } from "react";
import { createPublicClient } from "@/lib/supabase/public";
import type { Tables } from "@/lib/supabase/database.types";
import { currencyDigitsMap } from "@/lib/reference/queries";
import { escapeLike, expandCategory, SHOP_PAGE_SIZE, toTsQuery, type ShopFilters } from "./shop-params";

/**
 * Public shop reads. Everything here runs as a logged-out visitor (see
 * createPublicClient), so row security alone decides what is visible: active,
 * not under review, and the vendor approved.
 */

export type ShopCurrency = Pick<Tables<"currencies">, "code" | "name" | "symbol" | "minor_unit_digits">;
export type ShopCategory = Pick<Tables<"categories">, "slug" | "name" | "parent_slug" | "sort_order">;
export type ShopCountry = Pick<Tables<"countries">, "code" | "name">;

export type ShopReferences = {
  currencies: ShopCurrency[];
  currencyDigits: Record<string, number>;
  categories: ShopCategory[];
  countries: ShopCountry[];
  /** Codes of countries items ship from, taken from active corridors. */
  origins: string[];
};

/** Reference lists the shop needs, loaded once per request. */
export const getShopReferences = cache(async (): Promise<ShopReferences> => {
  const supabase = createPublicClient();
  const [currencies, categories, countries, corridors] = await Promise.all([
    supabase
      .from("currencies")
      .select("code, name, symbol, minor_unit_digits")
      .eq("active", true)
      .order("code"),
    supabase.from("categories").select("slug, name, parent_slug, sort_order").order("sort_order"),
    supabase.from("countries").select("code, name").eq("active", true).order("name"),
    supabase.from("corridors").select("origin_country").eq("active", true),
  ]);
  for (const result of [currencies, categories, countries, corridors]) {
    if (result.error) throw new Error(`Could not load shop data: ${result.error.message}`);
  }
  return {
    currencies: currencies.data ?? [],
    currencyDigits: currencyDigitsMap(currencies.data ?? []),
    categories: categories.data ?? [],
    countries: countries.data ?? [],
    origins: [...new Set((corridors.data ?? []).map((corridor) => corridor.origin_country))].sort(),
  };
});

export type ShopProductCard = {
  id: string;
  title: string;
  brand: string | null;
  condition: Tables<"products">["condition"];
  price_minor: number;
  currency: string;
  stock: number;
  imagePath: string | null;
  /** Country the item ships from, from its corridor. */
  originCountry: string | null;
};

export type ShopPage = { products: ShopProductCard[]; total: number };

const CARD_COLUMNS =
  "id, title, brand, condition, price_minor, currency, stock, corridor_id, product_images(storage_path, sort_order)";

async function queryProducts(
  filters: ShopFilters,
  refs: ShopReferences,
  scope: { vendorId?: string } = {},
): Promise<ShopPage> {
  const supabase = createPublicClient();
  const empty: ShopPage = { products: [], total: 0 };

  // "Ships from" is a property of the corridor, so resolve matching corridors first.
  let corridorIds: string[] | null = null;
  if (filters.origin) {
    const { data, error } = await supabase
      .from("corridors")
      .select("id")
      .eq("origin_country", filters.origin)
      .eq("active", true);
    if (error) throw new Error(`Could not load routes: ${error.message}`);
    corridorIds = (data ?? []).map((row) => row.id);
    if (corridorIds.length === 0) return empty;
  }

  let query = supabase
    .from("products")
    .select(CARD_COLUMNS, { count: "exact" })
    // Only the first image of each product is needed for the grid.
    .order("sort_order", { referencedTable: "product_images", ascending: true })
    .limit(1, { referencedTable: "product_images" });

  if (scope.vendorId) query = query.eq("vendor_id", scope.vendorId);

  const tsQuery = filters.q ? toTsQuery(filters.q) : null;
  if (tsQuery) query = query.textSearch("search_vector", tsQuery, { config: "simple" });
  if (filters.category) query = query.in("category", expandCategory(filters.category, refs.categories));
  if (filters.brand) query = query.ilike("brand", escapeLike(filters.brand));
  if (filters.condition) query = query.eq("condition", filters.condition);
  if (corridorIds) query = query.in("corridor_id", corridorIds);
  if (filters.currency) query = query.eq("currency", filters.currency);
  if (filters.minPriceMinor !== null) query = query.gte("price_minor", filters.minPriceMinor);
  if (filters.maxPriceMinor !== null) query = query.lte("price_minor", filters.maxPriceMinor);

  if (filters.sort === "price_asc") query = query.order("price_minor", { ascending: true });
  else if (filters.sort === "price_desc") query = query.order("price_minor", { ascending: false });
  else query = query.order("created_at", { ascending: false });
  // A second key keeps pages stable when prices or dates tie.
  query = query.order("id", { ascending: true });

  const from = (filters.page - 1) * SHOP_PAGE_SIZE;
  const { data, error, count } = await query.range(from, from + SHOP_PAGE_SIZE - 1);
  if (error) {
    // Asking for a page past the end is not a failure.
    if (error.code === "PGRST103") return { products: [], total: count ?? 0 };
    throw new Error(`Could not load products: ${error.message}`);
  }

  const rows = data ?? [];
  const routeIds = [...new Set(rows.map((row) => row.corridor_id))];
  const origins = new Map<string, string>();
  if (routeIds.length > 0) {
    const { data: routes, error: routesError } = await supabase
      .from("corridors")
      .select("id, origin_country")
      .in("id", routeIds);
    if (routesError) throw new Error(`Could not load routes: ${routesError.message}`);
    for (const route of routes ?? []) origins.set(route.id, route.origin_country);
  }

  return {
    total: count ?? rows.length,
    products: rows.map((row) => ({
      id: row.id,
      title: row.title,
      brand: row.brand,
      condition: row.condition,
      price_minor: row.price_minor,
      currency: row.currency,
      stock: row.stock,
      imagePath: row.product_images[0]?.storage_path ?? null,
      originCountry: origins.get(row.corridor_id) ?? null,
    })),
  };
}

export function listShopProducts(filters: ShopFilters, refs: ShopReferences): Promise<ShopPage> {
  return queryProducts(filters, refs);
}

/** A vendor's public listing, using the same paging as the shop. */
export function listVendorShopProducts(
  vendorId: string,
  page: number,
  refs: ShopReferences,
): Promise<ShopPage> {
  const filters: ShopFilters = {
    q: null,
    category: null,
    brand: null,
    condition: null,
    origin: null,
    currency: null,
    minPriceMinor: null,
    maxPriceMinor: null,
    sort: "newest",
    page,
    sortNeedsCurrency: false,
  };
  return queryProducts(filters, refs, { vendorId });
}

/** Brands of products visitors can see, for the filter list. */
export const listShopBrands = cache(async (): Promise<{ brand: string; count: number }[]> => {
  const supabase = createPublicClient();
  const { data, error } = await supabase.from("shop_brands").select("brand, product_count").order("brand");
  if (error) throw new Error(`Could not load brands: ${error.message}`);
  return (data ?? []).flatMap((row) =>
    row.brand ? [{ brand: row.brand, count: row.product_count ?? 0 }] : [],
  );
});

export type ShopVendor = {
  id: string;
  business_name: string;
  country_code: string;
  city: string;
  categories: string[];
  created_at: string;
};

function toShopVendor(row: {
  id: string | null;
  business_name: string | null;
  country_code: string | null;
  city: string | null;
  categories: string[] | null;
  created_at: string | null;
}): ShopVendor | null {
  if (!row.id || !row.business_name || !row.country_code || !row.city || !row.created_at) return null;
  return {
    id: row.id,
    business_name: row.business_name,
    country_code: row.country_code,
    city: row.city,
    categories: row.categories ?? [],
    created_at: row.created_at,
  };
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: string): boolean => UUID_PATTERN.test(value);

/** An approved vendor's public profile, or null (unknown, pending, rejected or suspended). */
export async function getShopVendor(vendorId: string): Promise<ShopVendor | null> {
  if (!isUuid(vendorId)) return null;
  const supabase = createPublicClient();
  const { data, error } = await supabase
    .from("vendor_directory")
    .select("id, business_name, country_code, city, categories, created_at")
    .eq("id", vendorId)
    .maybeSingle();
  if (error) throw new Error(`Could not load vendor: ${error.message}`);
  return data ? toShopVendor(data) : null;
}

export type ShopProductDetail = {
  id: string;
  title: string;
  description: string;
  brand: string | null;
  category: string;
  condition: Tables<"products">["condition"];
  condition_notes: string | null;
  price_minor: number;
  currency: string;
  stock: number;
  weight_grams: number | null;
  warranty_months: number;
  requires_special_handling: boolean;
  specs: Record<string, string>;
  images: { id: string; storage_path: string }[];
  vendor: ShopVendor | null;
  corridor: Pick<
    Tables<"corridors">,
    | "id"
    | "name"
    | "origin_country"
    | "destination_country"
    | "default_transit_days_min"
    | "default_transit_days_max"
  > | null;
};

/** A product visitors may see, with its vendor and route, or null. */
export async function getShopProduct(productId: string): Promise<ShopProductDetail | null> {
  if (!isUuid(productId)) return null;
  const supabase = createPublicClient();
  const { data, error } = await supabase
    .from("products")
    .select(
      "id, title, description, brand, category, condition, condition_notes, price_minor, currency, stock, weight_grams, warranty_months, requires_special_handling, specs, vendor_id, corridor_id, product_images(id, storage_path, sort_order)",
    )
    .eq("id", productId)
    .order("sort_order", { referencedTable: "product_images", ascending: true })
    .maybeSingle();
  if (error) throw new Error(`Could not load product: ${error.message}`);
  if (!data) return null;

  const [vendor, corridor] = await Promise.all([
    getShopVendor(data.vendor_id),
    supabase
      .from("corridors")
      .select(
        "id, name, origin_country, destination_country, default_transit_days_min, default_transit_days_max",
      )
      .eq("id", data.corridor_id)
      .maybeSingle(),
  ]);
  if (corridor.error) throw new Error(`Could not load route: ${corridor.error.message}`);

  const specs: Record<string, string> = {};
  if (data.specs && typeof data.specs === "object" && !Array.isArray(data.specs)) {
    for (const [key, value] of Object.entries(data.specs)) if (typeof value === "string") specs[key] = value;
  }

  return {
    id: data.id,
    title: data.title,
    description: data.description,
    brand: data.brand,
    category: data.category,
    condition: data.condition,
    condition_notes: data.condition_notes,
    price_minor: data.price_minor,
    currency: data.currency,
    stock: data.stock,
    weight_grams: data.weight_grams,
    warranty_months: data.warranty_months,
    requires_special_handling: data.requires_special_handling,
    specs,
    images: data.product_images.map((image) => ({ id: image.id, storage_path: image.storage_path })),
    vendor,
    corridor: corridor.data,
  };
}
