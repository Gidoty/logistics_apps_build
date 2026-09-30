import { ProductCard } from "@/components/shop/product-card";
import type { ShopCurrency, ShopProductCard } from "@/lib/catalog/shop-queries";

export function ProductGrid({
  products,
  currencies,
  countryNames,
}: {
  products: ShopProductCard[];
  currencies: ShopCurrency[];
  countryNames: Record<string, string>;
}) {
  return (
    <ul className="grid grid-cols-2 gap-x-3 gap-y-5 sm:grid-cols-3 lg:grid-cols-4">
      {products.map((product, index) => (
        <ProductCard
          key={product.id}
          product={product}
          currencies={currencies}
          countryNames={countryNames}
          // The first row is what people see first on a phone.
          preload={index < 2}
        />
      ))}
    </ul>
  );
}
