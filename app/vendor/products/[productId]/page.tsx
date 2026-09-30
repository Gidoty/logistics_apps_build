import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ImageManager } from "@/components/catalog/image-manager";
import { ProductForm } from "@/components/catalog/product-form";
import { ProductStatusActions } from "@/components/catalog/product-status-actions";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { requireApprovedVendor } from "@/lib/auth/session";
import { loadProductFormOptions } from "@/lib/catalog/context";
import { productToFormValues } from "@/lib/catalog/form-values";
import { getOwnProduct } from "@/lib/catalog/queries";
import { isUuid } from "@/lib/catalog/shop-queries";
import { createClient } from "@/lib/supabase/server";
import { getOwnVendor } from "@/lib/vendors/queries";

export const metadata: Metadata = { title: "Edit product" };

export default async function EditProductPage({
  params,
  searchParams,
}: PageProps<"/vendor/products/[productId]">) {
  const { productId } = await params;
  const user = await requireApprovedVendor(`/vendor/products/${productId}`);
  if (!isUuid(productId)) notFound();

  const [product, vendor, query] = await Promise.all([
    getOwnProduct(productId),
    getOwnVendor(user.id),
    searchParams,
  ]);
  if (!product || !vendor) notFound();

  const supabase = await createClient();
  const options = await loadProductFormOptions(supabase, vendor.country_code);
  const flagged = product.flagged_at !== null;

  return (
    <div className="mx-auto grid max-w-2xl gap-6 px-4 py-8">
      <div className="grid gap-1">
        <Link href="/vendor/products" className="text-primary text-sm underline">
          Your products
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold">{product.title}</h1>
          {flagged ? (
            <Badge variant="outline">Under review</Badge>
          ) : product.active ? (
            <Badge>Live in shop</Badge>
          ) : (
            <Badge variant="secondary">Hidden</Badge>
          )}
        </div>
      </div>

      {query.created === "1" && !flagged ? (
        <Alert variant="success">Saved. Now add photos, then publish the product to the shop.</Alert>
      ) : null}
      {flagged ? (
        <Alert>
          This listing is under review and stays hidden until an admin clears it. It contains words we check
          before publishing. You can keep editing the details and photos while you wait.
        </Alert>
      ) : null}

      <ProductStatusActions
        productId={product.id}
        active={product.active}
        flagged={flagged}
        imageCount={product.images.length}
      />

      <ImageManager
        productId={product.id}
        vendorId={vendor.id}
        initialImages={product.images.map((image) => ({ id: image.id, storage_path: image.storage_path }))}
      />

      <section aria-labelledby="details-heading" className="grid gap-3">
        <h2 id="details-heading" className="text-lg font-semibold">
          Details
        </h2>
        <ProductForm
          options={options}
          productId={product.id}
          initial={productToFormValues(product, options.context.currencies)}
        />
      </section>
    </div>
  );
}
