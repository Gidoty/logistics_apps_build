import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ConditionBadge } from "@/components/shop/condition-badge";
import { ProductImage } from "@/components/shop/product-image";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatStock, formatTransitDays, formatWarranty } from "@/lib/catalog/format";
import { CONDITION_LABELS } from "@/lib/catalog/schemas";
import { getShopProduct, getShopReferences } from "@/lib/catalog/shop-queries";
import { formatMoney } from "@/lib/money";

export async function generateMetadata({ params }: PageProps<"/shop/[productId]">): Promise<Metadata> {
  const product = await getShopProduct((await params).productId);
  if (!product) return { title: "Product not found" };
  return {
    title: product.title,
    description: `${CONDITION_LABELS[product.condition]} ${product.title}. ${product.description}`.slice(
      0,
      160,
    ),
  };
}

export default async function ProductPage({ params }: PageProps<"/shop/[productId]">) {
  const { productId } = await params;
  const [product, refs] = await Promise.all([getShopProduct(productId), getShopReferences()]);
  if (!product) notFound();

  const currency = refs.currencies.find((item) => item.code === product.currency);
  const countryName = (code: string) => refs.countries.find((country) => country.code === code)?.name ?? code;
  const transit = product.corridor
    ? formatTransitDays(product.corridor.default_transit_days_min, product.corridor.default_transit_days_max)
    : null;
  const outOfStock = product.stock <= 0;
  const specEntries = Object.entries(product.specs);

  return (
    <div className="mx-auto grid max-w-5xl gap-6 px-4 py-6 md:grid-cols-2 md:items-start">
      <div className="min-w-0">
        {product.images.length > 0 ? (
          // Swipe sideways on a phone. No JavaScript needed, so it stays light.
          <ul
            className="flex snap-x snap-mandatory gap-2 overflow-x-auto rounded-lg"
            aria-label={`Photos of ${product.title}`}
          >
            {product.images.map((image, index) => (
              <li
                key={image.id}
                className="bg-muted relative aspect-square w-full shrink-0 snap-center overflow-hidden rounded-lg border"
              >
                <ProductImage
                  path={image.storage_path}
                  alt={`${product.title}, photo ${index + 1} of ${product.images.length}`}
                  sizes="(max-width: 768px) 100vw, 480px"
                  preload={index === 0}
                />
              </li>
            ))}
          </ul>
        ) : (
          <div className="relative aspect-square overflow-hidden rounded-lg border">
            <ProductImage path={null} alt="" sizes="100vw" />
          </div>
        )}
        {product.images.length > 1 ? (
          <p className="text-muted-foreground mt-2 text-xs">
            Swipe to see all {product.images.length} photos.
          </p>
        ) : null}
      </div>

      <div className="grid gap-4">
        <div className="grid gap-1">
          {product.brand ? <p className="text-muted-foreground text-sm">{product.brand}</p> : null}
          <h1 className="text-2xl leading-tight font-bold tracking-tight">{product.title}</h1>
        </div>

        <div className="grid gap-1">
          <p className="text-3xl font-bold">
            {currency
              ? formatMoney(product.price_minor, currency, { withCode: true })
              : `${product.price_minor} ${product.currency}`}
          </p>
          <p className="text-muted-foreground text-sm">
            Final delivered price, including shipping and customs, is shown before you pay.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <ConditionBadge condition={product.condition} showNew />
          <Badge variant="outline">{formatWarranty(product.warranty_months)}</Badge>
          <Badge variant={outOfStock ? "outline" : "secondary"}>{formatStock(product.stock)}</Badge>
        </div>

        {product.condition !== "new" && product.condition_notes ? (
          <div className="bg-muted/40 rounded-lg border p-3 text-sm">
            <p className="font-medium">About the condition</p>
            <p className="text-muted-foreground mt-1 whitespace-pre-line">{product.condition_notes}</p>
          </div>
        ) : null}

        <div className="grid gap-1">
          <Button disabled className="w-full" size="lg" aria-describedby="buy-note">
            Coming soon
          </Button>
          <p id="buy-note" className="text-muted-foreground text-xs">
            Buying opens soon. Browse now and come back to order.
          </p>
        </div>

        <dl className="grid gap-2 rounded-lg border p-3 text-sm">
          {product.corridor ? (
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Ships from</dt>
              <dd className="text-right font-medium">{countryName(product.corridor.origin_country)}</dd>
            </div>
          ) : null}
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Estimated delivery window</dt>
            <dd className="text-right font-medium">{transit ?? "Not available yet"}</dd>
          </div>
        </dl>

        {product.requires_special_handling ? (
          <Alert>
            This item needs special handling for shipping, for example a large lithium battery. Delivery
            options and cost may differ, and this is included in your final price.
          </Alert>
        ) : null}

        {product.vendor ? (
          <div className="grid gap-1 rounded-lg border p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Link href={`/vendors/${product.vendor.id}`} className="text-primary font-semibold underline">
                {product.vendor.business_name}
              </Link>
              <Badge>Verified vendor</Badge>
            </div>
            <p className="text-muted-foreground">
              {product.vendor.city}, {countryName(product.vendor.country_code)}
            </p>
          </div>
        ) : null}
      </div>

      <div className="grid gap-6 md:col-span-2">
        {specEntries.length > 0 ? (
          <section aria-labelledby="specs-heading" className="grid gap-2">
            <h2 id="specs-heading" className="text-lg font-semibold">
              Specifications
            </h2>
            <table className="w-full text-sm">
              <tbody>
                {specEntries.map(([key, value]) => (
                  <tr key={key} className="border-b last:border-0">
                    <th scope="row" className="text-muted-foreground w-2/5 py-2 pr-3 text-left font-medium">
                      {key}
                    </th>
                    <td className="py-2">{value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ) : null}

        <section aria-labelledby="description-heading" className="grid gap-2">
          <h2 id="description-heading" className="text-lg font-semibold">
            Description
          </h2>
          <p className="max-w-prose text-sm leading-relaxed whitespace-pre-line">{product.description}</p>
        </section>
      </div>
    </div>
  );
}
