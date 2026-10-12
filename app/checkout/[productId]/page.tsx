import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckoutForm } from "@/components/orders/checkout-form";
import { ProductImage } from "@/components/shop/product-image";
import { requireUser } from "@/lib/auth/session";
import { getShopProduct } from "@/lib/catalog/shop-queries";
import { formatMoney } from "@/lib/money";
import { getProfile } from "@/lib/profile/queries";
import { listOwnRecipients, listRegionNames } from "@/lib/recipients/queries";
import { listActiveCurrencies } from "@/lib/reference/queries";

export const metadata: Metadata = { title: "Checkout", robots: { index: false } };

export default async function CheckoutPage({ params }: PageProps<"/checkout/[productId]">) {
  const { productId } = await params;
  const user = await requireUser(`/checkout/${productId}`);
  const product = await getShopProduct(productId);
  if (!product) notFound();

  const [profile, recipients, states, currencies] = await Promise.all([
    getProfile(user.id),
    listOwnRecipients(),
    listRegionNames("NG"),
    listActiveCurrencies(),
  ]);
  const listed = currencies.find((c) => c.code === product.currency);
  const available = product.stock > 0 && product.weight_grams !== null;

  return (
    <div className="mx-auto grid max-w-xl gap-5 px-4 py-8">
      <div className="grid gap-1">
        <Link href={`/shop/${product.id}`} className="text-primary text-sm underline">
          Back to the product
        </Link>
        <h1 className="text-2xl font-bold">Checkout</h1>
      </div>
      <div className="flex gap-3 rounded-xl border p-3">
        <div className="bg-muted relative size-20 shrink-0 overflow-hidden rounded-md">
          <ProductImage path={product.images[0]?.storage_path ?? null} alt="" sizes="80px" />
        </div>
        <div className="grid min-w-0 content-start gap-1">
          <p className="line-clamp-2 text-sm font-medium break-words">{product.title}</p>
          <p className="text-muted-foreground text-xs">
            Listed at{" "}
            {listed ? formatMoney(product.price_minor, listed, { withCode: true }) : product.price_minor}.
            Shipping, customs and delivery are added next.
          </p>
        </div>
      </div>
      {available ? (
        <CheckoutForm
          productId={product.id}
          maxQuantity={Math.min(product.stock, 100)}
          recipients={recipients}
          states={states}
          currencies={currencies}
          defaultCurrency={profile?.preferred_currency ?? "NGN"}
        />
      ) : (
        <p className="text-muted-foreground rounded-lg border border-dashed px-4 py-8 text-center text-sm">
          {product.stock <= 0 ? "This item is out of stock." : "Ask us for a delivered price for this item."}
        </p>
      )}
    </div>
  );
}
