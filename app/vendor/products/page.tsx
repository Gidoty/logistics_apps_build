import type { Metadata } from "next";
import Link from "next/link";
import { ProductImage } from "@/components/shop/product-image";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { requireApprovedVendor } from "@/lib/auth/session";
import { listOwnProducts } from "@/lib/catalog/queries";
import { formatMoney } from "@/lib/money";
import { listActiveCurrencies } from "@/lib/reference/queries";

export const metadata: Metadata = { title: "Your products" };

export default async function VendorProductsPage({ searchParams }: PageProps<"/vendor/products">) {
  await requireApprovedVendor("/vendor/products");
  const [products, currencies, params] = await Promise.all([
    listOwnProducts(),
    listActiveCurrencies(),
    searchParams,
  ]);

  return (
    <div className="mx-auto grid max-w-3xl gap-5 px-4 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="grid gap-1">
          <Link href="/vendor" className="text-primary text-sm underline">
            Vendor
          </Link>
          <h1 className="text-2xl font-bold">Your products</h1>
        </div>
        <Link href="/vendor/products/new" className={buttonVariants()}>
          Add a product
        </Link>
      </div>

      {params.deleted === "1" ? <Alert variant="success">Product deleted.</Alert> : null}
      {params.hidden === "1" ? (
        <Alert>
          This product was ordered before, so it cannot be deleted. It is hidden from the shop instead.
        </Alert>
      ) : null}

      {products.length === 0 ? (
        <div className="grid justify-items-center gap-3 rounded-lg border border-dashed px-4 py-12 text-center">
          <h2 className="text-lg font-semibold">No products yet</h2>
          <p className="text-muted-foreground max-w-sm text-sm">
            Add your first product, then add photos and publish it to the shop.
          </p>
          <Link href="/vendor/products/new" className={buttonVariants()}>
            Add a product
          </Link>
        </div>
      ) : (
        <ul className="grid gap-3">
          {products.map((product) => {
            const currency = currencies.find((item) => item.code === product.currency);
            return (
              <li key={product.id}>
                <Link
                  href={`/vendor/products/${product.id}`}
                  className="hover:bg-accent focus-visible:ring-ring/50 grid grid-cols-[4rem_1fr] gap-3 rounded-lg border p-3 outline-none focus-visible:ring-[3px]"
                >
                  <div className="bg-muted relative size-16 overflow-hidden rounded-md">
                    <ProductImage path={product.imagePath} alt="" sizes="64px" />
                  </div>
                  <div className="grid min-w-0 content-center gap-1">
                    <span className="truncate font-medium">{product.title}</span>
                    <span className="text-muted-foreground text-sm">
                      {currency
                        ? formatMoney(product.price_minor, currency)
                        : `${product.price_minor} ${product.currency}`}
                      {" · "}
                      {product.stock} in stock
                    </span>
                    <span>
                      {product.flagged_at ? (
                        <Badge variant="outline">Under review</Badge>
                      ) : product.active ? (
                        <Badge>Live in shop</Badge>
                      ) : (
                        <Badge variant="secondary">Hidden</Badge>
                      )}
                    </span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
