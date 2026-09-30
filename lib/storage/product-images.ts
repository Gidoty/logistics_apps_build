/**
 * Rules for product image uploads. The limits mirror the `product-images`
 * bucket and the product_images trigger in the catalog migrations.
 * tests/db checks that they stay in sync.
 *
 * Path layout: <vendor_id>/<product_id>/<random>.<jpg|png|webp>
 * Demo data from supabase/seed-dev.sql uses demo/<name>.webp, served from
 * /public/demo. Only server-side code can write those rows.
 */
export const PRODUCT_IMAGE_BUCKET = "product-images";
/** Largest original file a vendor may pick. Checked in the browser before compression. */
export const PRODUCT_IMAGE_MAX_ORIGINAL_BYTES = 5 * 1024 * 1024;
/** Largest file the bucket accepts. Compressed images are far smaller than this. */
export const PRODUCT_IMAGE_MAX_STORED_BYTES = 1024 * 1024;
/** What the browser compressor aims for. */
export const PRODUCT_IMAGE_TARGET_BYTES = 300 * 1000;
/** Longest side after compression, in pixels. */
export const PRODUCT_IMAGE_MAX_SIDE = 1600;
export const PRODUCT_IMAGE_MAX_PER_PRODUCT = 6;

export const PRODUCT_IMAGE_EXTENSIONS = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
} as const;

export type ProductImageMimeType = keyof typeof PRODUCT_IMAGE_EXTENSIONS;

export const PRODUCT_IMAGE_MIME_TYPES = Object.keys(PRODUCT_IMAGE_EXTENSIONS) as ProductImageMimeType[];

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const PATH_PATTERN = new RegExp(`^(${UUID})/(${UUID})/[A-Za-z0-9_-]{1,64}\\.(jpg|png|webp)$`);
const DEMO_PATTERN = /^demo\/[a-z0-9-]{1,64}\.(jpg|png|webp)$/;

export function isProductImageMimeType(value: string): value is ProductImageMimeType {
  return Object.hasOwn(PRODUCT_IMAGE_EXTENSIONS, value);
}

/**
 * Checks a picked file before compression. Returns a message for the user, or
 * null when the file is fine. The bucket enforces its own limits on the server.
 */
export function validateProductImageFile(file: { type: string; size: number }): string | null {
  if (!isProductImageMimeType(file.type)) return "Use a JPG, PNG or WebP image.";
  if (file.size <= 0) return "That file is empty.";
  if (file.size > PRODUCT_IMAGE_MAX_ORIGINAL_BYTES) {
    return `Images must be smaller than ${PRODUCT_IMAGE_MAX_ORIGINAL_BYTES / (1024 * 1024)} MB.`;
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

export function isDemoImagePath(path: string): boolean {
  return DEMO_PATTERN.test(path);
}

/** Image URL for a stored path. `supabaseUrl` is NEXT_PUBLIC_SUPABASE_URL. */
export function productImageUrl(supabaseUrl: string, path: string): string {
  if (isDemoImagePath(path)) return `/${path}`;
  const base = supabaseUrl.replace(/\/+$/, "");
  return `${base}/storage/v1/object/public/${PRODUCT_IMAGE_BUCKET}/${path}`;
}
