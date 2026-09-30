import { minorToDecimalString, parseMoneyInput } from "@/lib/money";
import { PRODUCT_CONDITIONS, type ProductCondition } from "./schemas";

export const SHOP_PAGE_SIZE = 20;
export const SHOP_SORTS = ["newest", "price_asc", "price_desc"] as const;
export type ShopSort = (typeof SHOP_SORTS)[number];

export type ShopFilters = {
  q: string | null;
  category: string | null;
  brand: string | null;
  condition: ProductCondition | null;
  /** Two-letter country code the item ships from. */
  origin: string | null;
  currency: string | null;
  minPriceMinor: number | null;
  maxPriceMinor: number | null;
  sort: ShopSort;
  page: number;
  /** True when a price sort was requested without a currency, so it was ignored. */
  sortNeedsCurrency: boolean;
};

export type RawSearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

/**
 * Turns URL parameters into safe filters. Anything invalid is ignored, never an
 * error, so an old or edited link still opens the shop.
 * `currencies` is { code: decimal places } for the active currencies.
 *
 * Prices are compared only within one currency (products are listed in their
 * vendor's currency and converting needs the FX engine from a later batch),
 * so price filters and price sorting need a currency.
 */
export function parseShopParams(
  raw: RawSearchParams,
  currencies: Readonly<Record<string, number>>,
): ShopFilters {
  const q = first(raw.q).replace(/\s+/g, " ").slice(0, 80);
  const category = /^[a-z][a-z0-9_]{1,39}$/.test(first(raw.category)) ? first(raw.category) : null;
  const brand = first(raw.brand).slice(0, 80);
  const condition = (PRODUCT_CONDITIONS as readonly string[]).includes(first(raw.condition))
    ? (first(raw.condition) as ProductCondition)
    : null;
  const origin = /^[A-Za-z]{2}$/.test(first(raw.origin)) ? first(raw.origin).toUpperCase() : null;

  const currencyCode = first(raw.currency).toUpperCase();
  const currency = Object.hasOwn(currencies, currencyCode) ? currencyCode : null;

  let minPriceMinor: number | null = null;
  let maxPriceMinor: number | null = null;
  if (currency) {
    const digits = currencies[currency];
    const min = first(raw.min) === "" ? null : parseMoneyInput(first(raw.min), digits, { allowZero: true });
    const max = first(raw.max) === "" ? null : parseMoneyInput(first(raw.max), digits, { allowZero: true });
    minPriceMinor = min?.ok ? min.minor : null;
    maxPriceMinor = max?.ok ? max.minor : null;
    if (minPriceMinor !== null && maxPriceMinor !== null && minPriceMinor > maxPriceMinor) {
      [minPriceMinor, maxPriceMinor] = [maxPriceMinor, minPriceMinor];
    }
  }

  const requestedSort = (SHOP_SORTS as readonly string[]).includes(first(raw.sort))
    ? (first(raw.sort) as ShopSort)
    : "newest";
  const sortNeedsCurrency = requestedSort !== "newest" && currency === null;
  const sort = sortNeedsCurrency ? "newest" : requestedSort;

  const pageNumber = /^\d{1,4}$/.test(first(raw.page)) ? Number(first(raw.page)) : 1;

  return {
    q: q === "" ? null : q,
    category,
    brand: brand === "" ? null : brand,
    condition,
    origin,
    currency,
    minPriceMinor,
    maxPriceMinor,
    sort,
    page: Math.max(1, pageNumber),
    sortNeedsCurrency,
  };
}

/** A shop link for these filters. Defaults are left out so URLs stay short and shareable. */
export function shopHref(
  filters: ShopFilters,
  currencies: Readonly<Record<string, number>>,
  overrides: Partial<ShopFilters> = {},
): string {
  const f = { ...filters, ...overrides };
  const params = new URLSearchParams();
  if (f.q) params.set("q", f.q);
  if (f.category) params.set("category", f.category);
  if (f.brand) params.set("brand", f.brand);
  if (f.condition) params.set("condition", f.condition);
  if (f.origin) params.set("origin", f.origin);
  if (f.currency) {
    params.set("currency", f.currency);
    const digits = currencies[f.currency] ?? 2;
    if (f.minPriceMinor !== null) params.set("min", minorToDecimalString(f.minPriceMinor, digits));
    if (f.maxPriceMinor !== null) params.set("max", minorToDecimalString(f.maxPriceMinor, digits));
  }
  if (f.sort !== "newest") params.set("sort", f.sort);
  if (f.page > 1) params.set("page", String(f.page));
  const query = params.toString();
  return query ? `/shop?${query}` : "/shop";
}

/**
 * Builds a Postgres to_tsquery string from what a shopper typed. Every word
 * becomes a prefix match, so "sams gal" finds "Samsung Galaxy". Only letters
 * and numbers survive, so the text cannot change the query syntax.
 * Returns null when there is nothing to search for.
 */
export function toTsQuery(input: string): string | null {
  const words = input.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const tokens = words.slice(0, 6).map((word) => word.slice(0, 30));
  return tokens.length === 0 ? null : tokens.map((token) => `${token}:*`).join(" & ");
}

/** Escapes % _ and \ so a value is matched literally by ILIKE. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/** The category slugs to match: a group such as "electronics" expands to its sub-categories. */
export function expandCategory(
  slug: string,
  categories: readonly { slug: string; parent_slug: string | null }[],
): string[] {
  const children = categories
    .filter((category) => category.parent_slug === slug)
    .map((category) => category.slug);
  return children.length > 0 ? children : [slug];
}
