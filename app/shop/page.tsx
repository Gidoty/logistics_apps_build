import type { Metadata } from "next";
import Link from "next/link";
import { Pagination } from "@/components/shop/pagination";
import { ProductGrid } from "@/components/shop/product-grid";
import { ShopFiltersForm } from "@/components/shop/shop-filters";
import { buttonVariants } from "@/components/ui/button";
import { pageCount } from "@/lib/catalog/format";
import { parseShopParams, SHOP_PAGE_SIZE, shopHref } from "@/lib/catalog/shop-params";
import { getShopReferences, listShopBrands, listShopProducts } from "@/lib/catalog/shop-queries";

export const metadata: Metadata = {
  title: "Shop",
  description: "Electronics and everyday goods from verified vendors, delivered anywhere in Nigeria.",
};

export default async function ShopPage({ searchParams }: PageProps<"/shop">) {
  const refs = await getShopReferences();
  const filters = parseShopParams(await searchParams, refs.currencyDigits);
  const [{ products, total }, brands] = await Promise.all([
    listShopProducts(filters, refs),
    listShopBrands(),
  ]);

  const countryNames = Object.fromEntries(refs.countries.map((country) => [country.code, country.name]));
  const pages = pageCount(total, SHOP_PAGE_SIZE);
  const isFiltered = shopHref({ ...filters, page: 1 }, refs.currencyDigits) !== "/shop";
  // A link to page 9 of 2 finds nothing, but the shop is not empty.
  const pastTheEnd = filters.page > 1 && products.length === 0;

  return (
    <div className="mx-auto grid max-w-5xl gap-5 px-4 py-6">
      <div className="grid gap-1">
        <h1 className="text-2xl font-bold tracking-tight">Shop</h1>
        <p className="text-muted-foreground text-sm">
          Every item is from a verified vendor. You see one final price, including shipping and customs,
          before you pay.
        </p>
      </div>

      <ShopFiltersForm filters={filters} refs={refs} brands={brands} />

      {products.length > 0 ? (
        <>
          <p className="text-muted-foreground text-sm" aria-live="polite">
            {total} {total === 1 ? "product" : "products"}
          </p>
          <ProductGrid products={products} currencies={refs.currencies} countryNames={countryNames} />
          <Pagination
            page={filters.page}
            pageCount={pages}
            hrefFor={(page) => shopHref(filters, refs.currencyDigits, { page })}
          />
        </>
      ) : (
        <div className="grid justify-items-center gap-3 rounded-lg border border-dashed px-4 py-12 text-center">
          <h2 className="text-lg font-semibold">
            {pastTheEnd
              ? "That page is empty"
              : isFiltered
                ? "No products match your search"
                : "No products yet"}
          </h2>
          <p className="text-muted-foreground max-w-sm text-sm">
            {pastTheEnd
              ? "There are no more results. Go back to the first page."
              : isFiltered
                ? "Try fewer filters or a different word, for example a brand name."
                : "Vendors are adding products. Please check back soon."}
          </p>
          {pastTheEnd ? (
            <Link
              href={shopHref(filters, refs.currencyDigits, { page: 1 })}
              className={buttonVariants({ variant: "outline" })}
            >
              Go to the first page
            </Link>
          ) : isFiltered ? (
            <Link href="/shop" className={buttonVariants({ variant: "outline" })}>
              Clear search and filters
            </Link>
          ) : null}
        </div>
      )}
    </div>
  );
}
