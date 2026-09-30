"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin, requireApprovedVendor } from "@/lib/auth/session";
import { userFacingDbError } from "@/lib/db-errors";
import { formError, formSuccess, readText, type FormState } from "@/lib/form-state";
import {
  PRODUCT_IMAGE_BUCKET,
  PRODUCT_IMAGE_MAX_PER_PRODUCT,
  parseProductImagePath,
} from "@/lib/storage/product-images";
import { createClient } from "@/lib/supabase/server";
import { getOwnVendor } from "@/lib/vendors/queries";
import { loadProductFormOptions } from "./context";
import { describeHold, scanProduct } from "./prohibited";
import { createProductSchema, fieldErrorsFromIssues } from "./schemas";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FOREIGN_KEY_VIOLATION = "23503";

export type SaveProductResult =
  | { ok: true; productId: string; held: boolean; heldReason: string | null }
  | { ok: false; message: string; fieldErrors?: Record<string, string[]> };

export type SimpleResult = { ok: true } | { ok: false; message: string };

function refreshCatalog(productId?: string) {
  revalidatePath("/vendor/products");
  if (productId) revalidatePath(`/vendor/products/${productId}`);
  revalidatePath("/shop");
  if (productId) revalidatePath(`/shop/${productId}`);
}

/**
 * Creates or updates a product. The browser form and this action use the same
 * schema. A new product starts inactive: images are added next, then the
 * vendor publishes. If the wording contains a prohibited term the database
 * keeps the product inactive and flags it for admin review.
 */
export async function saveProduct(input: unknown, productId?: string): Promise<SaveProductResult> {
  const user = await requireApprovedVendor("/vendor/products");
  const vendor = await getOwnVendor(user.id);
  if (!vendor || vendor.status !== "approved")
    return { ok: false, message: "Your vendor account is not active." };
  if (productId !== undefined && !UUID_PATTERN.test(productId))
    return { ok: false, message: "Product not found." };

  const supabase = await createClient();
  const options = await loadProductFormOptions(supabase, vendor.country_code);
  const parsed = createProductSchema(options.context).safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      message: "Please fix the highlighted fields.",
      fieldErrors: fieldErrorsFromIssues(parsed.error.issues),
    };
  }
  const p = parsed.data;
  const row = {
    title: p.title,
    description: p.description,
    brand: p.brand,
    category: p.category,
    condition: p.condition,
    condition_notes: p.conditionNotes,
    price_minor: p.priceMinor,
    currency: p.currency,
    stock: p.stock,
    weight_grams: p.weightGrams,
    corridor_id: p.corridorId,
    specs: p.specs,
    warranty_months: p.warrantyMonths,
    requires_special_handling: p.requiresSpecialHandling,
  };

  const query =
    productId === undefined
      ? supabase
          .from("products")
          .insert({ vendor_id: vendor.id, ...row })
          .select("id, flagged_at")
          .single()
      : supabase.from("products").update(row).eq("id", productId).select("id, flagged_at").maybeSingle();
  const { data, error } = await query;

  if (error)
    return {
      ok: false,
      message: userFacingDbError(error, "We could not save the product. Please try again."),
    };
  if (!data) return { ok: false, message: "Product not found." };

  refreshCatalog(data.id);
  const terms = scanProduct(p);
  const held = data.flagged_at !== null;
  return { ok: true, productId: data.id, held, heldReason: held ? describeHold(terms) : null };
}

/** Publishes or hides a product. The database requires an image and no pending review to publish. */
export async function setProductActive(productId: string, active: boolean): Promise<SimpleResult> {
  await requireApprovedVendor("/vendor/products");
  if (!UUID_PATTERN.test(productId)) return { ok: false, message: "Product not found." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("products")
    .update({ active })
    .eq("id", productId)
    .select("id")
    .maybeSingle();
  if (error)
    return {
      ok: false,
      message: userFacingDbError(error, "We could not update the product. Please try again."),
    };
  if (!data) return { ok: false, message: "Product not found." };

  refreshCatalog(productId);
  return { ok: true };
}

export type DeleteProductResult =
  { ok: true; outcome: "deleted" | "deactivated" } | { ok: false; message: string };

/**
 * Deletes a product that has never been in an order. If it has been ordered the
 * database refuses (the order keeps pointing at it), so it is deactivated
 * instead and the vendor is told.
 */
export async function deleteProduct(productId: string): Promise<DeleteProductResult> {
  await requireApprovedVendor("/vendor/products");
  if (!UUID_PATTERN.test(productId)) return { ok: false, message: "Product not found." };

  const supabase = await createClient();
  const { data: images } = await supabase
    .from("product_images")
    .select("storage_path")
    .eq("product_id", productId);

  const { data, error } = await supabase
    .from("products")
    .delete()
    .eq("id", productId)
    .select("id")
    .maybeSingle();
  if (error) {
    if (error.code === FOREIGN_KEY_VIOLATION) {
      const { error: hideError } = await supabase
        .from("products")
        .update({ active: false })
        .eq("id", productId);
      if (hideError) return { ok: false, message: "We could not hide the product. Please try again." };
      refreshCatalog(productId);
      return { ok: true, outcome: "deactivated" };
    }
    return {
      ok: false,
      message: userFacingDbError(error, "We could not delete the product. Please try again."),
    };
  }
  if (!data) return { ok: false, message: "Product not found." };

  // Best effort: a leftover file is harmless and is not shown anywhere.
  const paths = (images ?? []).map((image) => image.storage_path);
  if (paths.length > 0) await supabase.storage.from(PRODUCT_IMAGE_BUCKET).remove(paths);

  refreshCatalog(productId);
  return { ok: true, outcome: "deleted" };
}

export type AttachImageResult =
  | { ok: true; image: { id: string; storage_path: string; sort_order: number } }
  | { ok: false; message: string };

/**
 * Records an image the browser already uploaded to <vendor_id>/<product_id>/.
 * The database checks the path and the limit of 6 images. If it refuses, the
 * uploaded file is removed again.
 */
export async function attachProductImage(productId: string, path: string): Promise<AttachImageResult> {
  const user = await requireApprovedVendor("/vendor/products");
  const parsedPath = parseProductImagePath(path);
  if (!parsedPath || parsedPath.productId !== productId || parsedPath.vendorId !== user.vendor?.id) {
    return { ok: false, message: "That image path is not valid." };
  }

  const supabase = await createClient();
  const { data: last } = await supabase
    .from("product_images")
    .select("sort_order")
    .eq("product_id", productId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data, error } = await supabase
    .from("product_images")
    .insert({ product_id: productId, storage_path: path, sort_order: (last?.sort_order ?? -1) + 1 })
    .select("id, storage_path, sort_order")
    .single();
  if (error) {
    await supabase.storage.from(PRODUCT_IMAGE_BUCKET).remove([path]);
    return {
      ok: false,
      message: userFacingDbError(
        error,
        `We could not save the image. A product can have up to ${PRODUCT_IMAGE_MAX_PER_PRODUCT}.`,
      ),
    };
  }

  refreshCatalog(productId);
  return { ok: true, image: data };
}

/** Removes an image. If it was the last one on a live product, the product is hidden. */
export async function removeProductImage(imageId: string): Promise<SimpleResult> {
  await requireApprovedVendor("/vendor/products");
  if (!UUID_PATTERN.test(imageId)) return { ok: false, message: "Image not found." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("product_images")
    .delete()
    .eq("id", imageId)
    .select("product_id, storage_path")
    .maybeSingle();
  if (error)
    return {
      ok: false,
      message: userFacingDbError(error, "We could not remove the image. Please try again."),
    };
  if (!data) return { ok: false, message: "Image not found." };

  await supabase.storage.from(PRODUCT_IMAGE_BUCKET).remove([data.storage_path]);

  const { count } = await supabase
    .from("product_images")
    .select("id", { count: "exact", head: true })
    .eq("product_id", data.product_id);
  if (count === 0) await supabase.from("products").update({ active: false }).eq("id", data.product_id);

  refreshCatalog(data.product_id);
  return { ok: true };
}

/** Saves a new image order. `orderedIds` lists the product's image ids, first to last. */
export async function reorderProductImages(productId: string, orderedIds: string[]): Promise<SimpleResult> {
  await requireApprovedVendor("/vendor/products");
  const valid =
    UUID_PATTERN.test(productId) &&
    orderedIds.length <= PRODUCT_IMAGE_MAX_PER_PRODUCT &&
    orderedIds.every((id) => UUID_PATTERN.test(id)) &&
    new Set(orderedIds).size === orderedIds.length;
  if (!valid) return { ok: false, message: "That order is not valid." };

  const supabase = await createClient();
  const results = await Promise.all(
    orderedIds.map((id, index) =>
      supabase.from("product_images").update({ sort_order: index }).eq("id", id).eq("product_id", productId),
    ),
  );
  if (results.some((result) => result.error))
    return { ok: false, message: "We could not save the new order." };

  refreshCatalog(productId);
  return { ok: true };
}

/** Admin: clear a flag so the vendor can publish the product. Logged to audit_log. */
export async function clearProductFlag(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin("/admin/products");
  const productId = readText(formData, "productId");
  if (!UUID_PATTERN.test(productId)) return formError("Product not found.");

  const supabase = await createClient();
  const { error } = await supabase.rpc("clear_product_flag", { _product_id: productId });
  if (error) return formError(userFacingDbError(error, "The flag could not be cleared. Please try again."));

  revalidatePath("/admin/products");
  revalidatePath("/vendor/products");
  return formSuccess("Flag cleared. The vendor can now publish the product.");
}
