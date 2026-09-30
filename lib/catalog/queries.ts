import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Tables } from "@/lib/supabase/database.types";

/** Vendor and admin catalog reads. These run as the signed-in user, so row security applies. */

export type OwnProductRow = Pick<
  Tables<"products">,
  "id" | "title" | "price_minor" | "currency" | "stock" | "active" | "flagged_at" | "category" | "created_at"
> & { imagePath: string | null };

export async function listOwnProducts(): Promise<OwnProductRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("products")
    .select(
      "id, title, price_minor, currency, stock, active, flagged_at, category, created_at, product_images(storage_path, sort_order)",
    )
    .order("sort_order", { referencedTable: "product_images", ascending: true })
    .limit(1, { referencedTable: "product_images" })
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(`Could not load your products: ${error.message}`);
  return (data ?? []).map(({ product_images, ...row }) => ({
    ...row,
    imagePath: product_images[0]?.storage_path ?? null,
  }));
}

export type OwnProduct = Tables<"products"> & {
  images: { id: string; storage_path: string; sort_order: number }[];
};

export async function getOwnProduct(productId: string): Promise<OwnProduct | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("products")
    .select("*, product_images(id, storage_path, sort_order)")
    .eq("id", productId)
    .order("sort_order", { referencedTable: "product_images", ascending: true })
    .maybeSingle();
  if (error) throw new Error(`Could not load the product: ${error.message}`);
  if (!data) return null;
  const { product_images, ...product } = data;
  return { ...product, images: product_images };
}

export type FlaggedProduct = Pick<
  Tables<"products">,
  | "id"
  | "title"
  | "description"
  | "brand"
  | "category"
  | "price_minor"
  | "currency"
  | "flagged_at"
  | "flagged_reason"
> & { vendor: { id: string; business_name: string } | null };

/** Products held for review, oldest first. Admin only (row security). */
export async function listFlaggedProducts(): Promise<FlaggedProduct[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("products")
    .select(
      "id, title, description, brand, category, price_minor, currency, flagged_at, flagged_reason, vendor:vendors!products_vendor_id_fkey(id, business_name)",
    )
    .not("flagged_at", "is", null)
    .order("flagged_at", { ascending: true })
    .limit(100);
  if (error) throw new Error(`Could not load flagged products: ${error.message}`);
  return data ?? [];
}
