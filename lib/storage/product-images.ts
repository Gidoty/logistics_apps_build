/**
 * Rules for product image uploads. The limits mirror the `product-images`
 * bucket and the product_images trigger in
 * supabase/migrations/20260930000100_payout_review_and_product_images.sql.
 * tests/db checks that the two stay in sync.
 *
 * Path layout: <vendor_id>/<product_id>/<random>.<jpg|png|webp>
 */
export const PRODUCT_IMAGE_BUCKET = "product-images";
export const PRODUCT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const PRODUCT_IMAGE_MAX_PER_PRODUCT = 10;

export const PRODUCT_IMAGE_EXTENSIONS = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
} as const;

export type ProductImageMimeType = keyof typeof PRODUCT_IMAGE_EXTENSIONS;

export const PRODUCT_IMAGE_MIME_TYPES = Object.keys(PRODUCT_IMAGE_EXTENSIONS) as ProductImageMimeType[];

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const PATH_PATTERN = new RegExp(`^(${UUID})/(${UUID})/[A-Za-z0-9_-]{1,64}\\.(jpg|png|webp)$`);

export function isProductImageMimeType(value: string): value is ProductImageMimeType {
  return Object.hasOwn(PRODUCT_IMAGE_EXTENSIONS, value);
}

/**
 * Checks a file before upload. Returns a message for the user, or null when
 * the file is fine. The bucket enforces the same limits on the server.
 */
export function validateProductImageFile(file: { type: string; size: number }): string | null {
  if (!isProductImageMimeType(file.type)) return "Use a JPG, PNG or WebP image.";
  if (file.size <= 0) return "That file is empty.";
  if (file.size > PRODUCT_IMAGE_MAX_BYTES) {
    return `Images must be smaller than ${PRODUCT_IMAGE_MAX_BYTES / (1024 * 1024)} MB.`;
  }
  return null;
}

/** The storage path for a new upload. The extension comes from the checked MIME type, never from the file name. */
export function buildProductImagePath(
  vendorId: string,
  productId: string,
  mimeType: ProductImageMimeType,
  fileId: string = crypto.randomUUID(),
): string {
  return `${vendorId}/${productId}/${fileId}.${PRODUCT_IMAGE_EXTENSIONS[mimeType]}`;
}

export function parseProductImagePath(path: string): { vendorId: string; productId: string } | null {
  const match = PATH_PATTERN.exec(path);
  return match ? { vendorId: match[1], productId: match[2] } : null;
}

/** Public CDN URL for a stored image. `supabaseUrl` is NEXT_PUBLIC_SUPABASE_URL. */
export function productImageUrl(supabaseUrl: string, path: string): string {
  const base = supabaseUrl.replace(/\/+$/, "");
  return `${base}/storage/v1/object/public/${PRODUCT_IMAGE_BUCKET}/${path}`;
}
