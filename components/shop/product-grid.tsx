import { ProductCard } from "@/components/shop/product-card";
import type { ShopCurrency, ShopProductCard } from "@/lib/catalog/shop-queries";
import type { ShopEstimate } from "@/lib/pricing/shop-estimate";
import type { CurrencyOption } from "@/lib/reference/queries";

export function ProductGrid({
  products,
  currencies,
  countryNames,
  estimates,
  viewerCurrencies,
}: {
  products: ShopProductCard[];
  currencies: ShopCurrency[];
  countryNames: Record<string, string>;
  estimates: Record<string, ShopEstimate>;
  viewerCurrencies: CurrencyOption[];
}) {
  return (
    <ul className="grid grid-cols-2 gap-x-3 gap-y-5 sm:grid-cols-3 lg:grid-cols-4">
      {products.map((product, index) => (
        <ProductCard
          key={product.id}
          product={product}
          currencies={currencies}
          countryNames={countryNames}
          estimate={estimates[product.id] ?? { ok: false }}
          viewerCurrencies={viewerCurrencies}
          // The first row is what people see first on a phone.
          preload={index < 2}
        />
      ))}
    </ul>
  );
}
