import { describe, expect, it } from "vitest";
import {
  escapeLike,
  expandCategory,
  parseShopParams,
  SHOP_PAGE_SIZE,
  shopHref,
  toTsQuery,
} from "@/lib/catalog/shop-params";

const currencies = { NGN: 2, USD: 2, CNY: 2, JPY: 0 };
const parse = (raw: Record<string, string | string[] | undefined>) => parseShopParams(raw, currencies);

describe("parseShopParams", () => {
  it("returns plain defaults for an empty URL", () => {
    expect(parse({})).toEqual({
      q: null,
      category: null,
      brand: null,
      condition: null,
      origin: null,
      currency: null,
      minPriceMinor: null,
      maxPriceMinor: null,
      sort: "newest",
      page: 1,
      sortNeedsCurrency: false,
    });
    expect(SHOP_PAGE_SIZE).toBe(20);
  });

  it("reads every filter", () => {
    expect(
      parse({
        q: "  galaxy   a15 ",
        category: "phones",
        brand: "Samsung",
        condition: "refurbished",
        origin: "cn",
        currency: "cny",
        min: "1,000",
        max: "5000.50",
        sort: "price_desc",
        page: "3",
      }),
    ).toEqual({
      q: "galaxy a15",
      category: "phones",
      brand: "Samsung",
      condition: "refurbished",
      origin: "CN",
      currency: "CNY",
      minPriceMinor: 100_000,
      maxPriceMinor: 500_050,
      sort: "price_desc",
      page: 3,
      sortNeedsCurrency: false,
    });
  });

  it("ignores invalid values instead of failing", () => {
    const result = parse({
      category: "Bad Category!",
      condition: "broken",
      origin: "CHINA",
      currency: "XYZ",
      min: "abc",
      sort: "popular",
      page: "-2",
    });
    expect(result).toMatchObject({
      category: null,
      condition: null,
      origin: null,
      currency: null,
      sort: "newest",
      page: 1,
    });
  });

  it("takes the first value when a parameter is repeated", () => {
    expect(parse({ brand: ["Apple", "Samsung"] }).brand).toBe("Apple");
  });

  it("swaps a reversed price range and reads prices using the currency's decimals", () => {
    expect(parse({ currency: "NGN", min: "500", max: "100" })).toMatchObject({
      minPriceMinor: 10_000,
      maxPriceMinor: 50_000,
    });
    expect(parse({ currency: "JPY", min: "1000" }).minPriceMinor).toBe(1000);
    expect(parse({ currency: "NGN", min: "10.999" }).minPriceMinor).toBeNull();
  });

  it("needs a currency for price filters and price sorting", () => {
    expect(parse({ min: "100", max: "900" })).toMatchObject({ minPriceMinor: null, maxPriceMinor: null });
    expect(parse({ sort: "price_asc" })).toMatchObject({ sort: "newest", sortNeedsCurrency: true });
    expect(parse({ sort: "price_asc", currency: "USD" })).toMatchObject({
      sort: "price_asc",
      sortNeedsCurrency: false,
    });
  });

  it("caps the search text and the page number", () => {
    expect(parse({ q: "x".repeat(200) }).q).toHaveLength(80);
    expect(parse({ page: "99999" }).page).toBe(1);
  });
});

describe("shopHref", () => {
  it("round-trips filters and leaves out defaults", () => {
    const filters = parse({
      q: "galaxy",
      category: "phones",
      currency: "CNY",
      min: "1000",
      sort: "price_asc",
      page: "2",
    });
    const href = shopHref(filters, currencies);
    expect(href).toBe("/shop?q=galaxy&category=phones&currency=CNY&min=1000.00&sort=price_asc&page=2");
    const back = parse(Object.fromEntries(new URL(href, "http://x").searchParams));
    expect(back).toEqual(filters);
  });

  it("links to the bare shop when nothing is set, and applies overrides", () => {
    expect(shopHref(parse({}), currencies)).toBe("/shop");
    expect(shopHref(parse({ page: "4", q: "tv" }), currencies, { page: 1 })).toBe("/shop?q=tv");
  });

  it("drops price values when there is no currency", () => {
    const filters = { ...parse({ currency: "NGN", min: "5" }), currency: null };
    expect(shopHref(filters, currencies)).toBe("/shop");
  });
});

describe("toTsQuery", () => {
  it("turns words into prefix matches joined with AND", () => {
    expect(toTsQuery("Sams gal")).toBe("sams:* & gal:*");
    expect(toTsQuery("iPhone 15 Pro")).toBe("iphone:* & 15:* & pro:*");
  });

  it("keeps only letters and numbers, so input cannot change the query syntax", () => {
    expect(toTsQuery("phone' | !secret & (a:*)")).toBe("phone:* & secret:* & a:*");
    expect(toTsQuery("<script>alert(1)</script>")).toBe("script:* & alert:* & 1:* & script:*");
    expect(toTsQuery("!!!")).toBeNull();
    expect(toTsQuery("")).toBeNull();
  });

  it("supports non-English letters and limits length", () => {
    expect(toTsQuery("Ọbọ")).toBe("ọbọ:*");
    expect(toTsQuery("a b c d e f g h")).toBe("a:* & b:* & c:* & d:* & e:* & f:*");
    expect(toTsQuery("x".repeat(100))).toBe(`${"x".repeat(30)}:*`);
  });
});

describe("escapeLike and expandCategory", () => {
  it("escapes wildcard characters", () => {
    expect(escapeLike("100%_pure\\")).toBe("100\\%\\_pure\\\\");
  });

  const categories = [
    { slug: "electronics", parent_slug: null },
    { slug: "phones", parent_slug: "electronics" },
    { slug: "laptops", parent_slug: "electronics" },
    { slug: "fashion", parent_slug: "general" },
  ];

  it("expands a group to its sub-categories and keeps a leaf as is", () => {
    expect(expandCategory("electronics", categories)).toEqual(["phones", "laptops"]);
    expect(expandCategory("phones", categories)).toEqual(["phones"]);
    expect(expandCategory("unknown", categories)).toEqual(["unknown"]);
  });
});
