import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Pagination } from "@/components/shop/pagination";
import { ProductGrid } from "@/components/shop/product-grid";
import { Badge } from "@/components/ui/badge";
import { pageCount } from "@/lib/catalog/format";
import { SHOP_PAGE_SIZE } from "@/lib/catalog/shop-params";
import { estimateProducts } from "@/lib/pricing/shop-estimate";
import { getViewerCurrency } from "@/lib/pricing/viewer-currency-read";
import { getShopReferences, getShopVendor, listVendorShopProducts } from "@/lib/catalog/shop-queries";

export async function generateMetadata({ params }: PageProps<"/vendors/[vendorId]">): Promise<Metadata> {
  const vendor = await getShopVendor((await params).vendorId);
  return { title: vendor ? vendor.business_name : "Vendor not found" };
}

export default async function VendorPage({ params, searchParams }: PageProps<"/vendors/[vendorId]">) {
  const { vendorId } = await params;
  const pageParam = (await searchParams).page;
  const page =
    typeof pageParam === "string" && /^\d{1,4}$/.test(pageParam) ? Math.max(1, Number(pageParam)) : 1;

  const [vendor, refs] = await Promise.all([getShopVendor(vendorId), getShopReferences()]);
  if (!vendor) notFound();
  const { products, total } = await listVendorShopProducts(vendor.id, page, refs);
  const viewer = await getViewerCurrency();
  const estimates = await estimateProducts(products, viewer.currency.code);

  const countryName =
    refs.countries.find((country) => country.code === vendor.country_code)?.name ?? vendor.country_code;
  const countryNames = Object.fromEntries(refs.countries.map((country) => [country.code, country.name]));
  const categoryNames = vendor.categories
    .map((slug) => refs.categories.find((category) => category.slug === slug)?.name)
    .filter((name): name is string => Boolean(name));

  return (
    <div className="mx-auto grid max-w-5xl gap-5 px-4 py-6">
      <div className="grid gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold tracking-tight">{vendor.business_name}</h1>
          <Badge>Verified vendor</Badge>
        </div>
        <p className="text-muted-foreground text-sm">
          {vendor.city}, {countryName}. On the platform since {new Date(vendor.created_at).getUTCFullYear()}.
        </p>
        {categoryNames.length > 0 ? (
          <p className="text-muted-foreground text-sm">Sells: {categoryNames.join(", ")}</p>
        ) : null}
      </div>

      {products.length > 0 ? (
        <>
          <p className="text-muted-foreground text-sm">
            {total} {total === 1 ? "product" : "products"}
          </p>
          <ProductGrid
            products={products}
            currencies={refs.currencies}
            countryNames={countryNames}
            estimates={estimates}
            viewerCurrencies={viewer.options}
          />
          <Pagination
            page={page}
            pageCount={pageCount(total, SHOP_PAGE_SIZE)}
            hrefFor={(next) => (next > 1 ? `/vendors/${vendor.id}?page=${next}` : `/vendors/${vendor.id}`)}
          />
        </>
      ) : (
        <div className="rounded-lg border border-dashed px-4 py-12 text-center">
          <h2 className="text-lg font-semibold">No products listed yet</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            This vendor has not published any products. Check back soon.
          </p>
        </div>
      )}
    </div>
  );
}
