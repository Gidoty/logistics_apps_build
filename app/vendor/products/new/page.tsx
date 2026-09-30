import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ProductForm } from "@/components/catalog/product-form";
import { requireApprovedVendor } from "@/lib/auth/session";
import { loadProductFormOptions } from "@/lib/catalog/context";
import { emptyProductValues } from "@/lib/catalog/form-values";
import { createClient } from "@/lib/supabase/server";
import { getOwnVendor } from "@/lib/vendors/queries";

export const metadata: Metadata = { title: "Add a product" };

export default async function NewProductPage() {
  const user = await requireApprovedVendor("/vendor/products/new");
  const vendor = await getOwnVendor(user.id);
  if (!vendor) notFound();

  const supabase = await createClient();
  const options = await loadProductFormOptions(supabase, vendor.country_code);

  return (
    <div className="mx-auto grid max-w-2xl gap-5 px-4 py-8">
      <div className="grid gap-1">
        <Link href="/vendor/products" className="text-primary text-sm underline">
          Your products
        </Link>
        <h1 className="text-2xl font-bold">Add a product</h1>
        <p className="text-muted-foreground text-sm">
          Fill in the details first. You add photos on the next step, then publish.
        </p>
      </div>
      <ProductForm
        options={options}
        initial={emptyProductValues(options.defaultCurrency, options.corridors[0]?.id ?? "")}
      />
    </div>
  );
}
