import Link from "next/link";
import { ConditionBadge } from "@/components/shop/condition-badge";
import { ProductImage } from "@/components/shop/product-image";
import { Badge } from "@/components/ui/badge";
import { formatMoney } from "@/lib/money";
import type { ShopCurrency, ShopProductCard } from "@/lib/catalog/shop-queries";

type Props = {
  product: ShopProductCard;
  currencies: ShopCurrency[];
  countryNames: Record<string, string>;
  /** Preload the first card images, which are at the top of the page. */
  preload?: boolean;
};

export function ProductCard({ product, currencies, countryNames, preload = false }: Props) {
  const currency = currencies.find((item) => item.code === product.currency);
  const price = currency
    ? formatMoney(product.price_minor, currency)
    : `${product.price_minor / 100} ${product.currency}`;
  const origin = product.originCountry ? countryNames[product.originCountry] : null;

  return (
    <li className="min-w-0">
      <Link
        href={`/shop/${product.id}`}
        className="group focus-visible:ring-ring/50 grid gap-2 rounded-lg outline-none focus-visible:ring-[3px]"
      >
        <div className="bg-muted relative aspect-square overflow-hidden rounded-lg border">
          <ProductImage
            path={product.imagePath}
            alt={product.title}
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 256px"
            preload={preload}
            className="transition-transform group-hover:scale-105"
          />
        </div>
        <div className="grid gap-1">
          <h3 className="line-clamp-2 text-sm leading-snug font-medium">{product.title}</h3>
          <p className="text-base font-semibold">{price}</p>
          <div className="text-muted-foreground flex flex-wrap items-center gap-1 text-xs">
            <ConditionBadge condition={product.condition} />
            {product.stock <= 0 ? <Badge variant="outline">Out of stock</Badge> : null}
            {origin ? <span>From {origin}</span> : null}
          </div>
        </div>
      </Link>
    </li>
  );
}
