/**
 * Rules for vendor ID documents. Private bucket: never public. The owner
 * uploads into <user_id>/ and admins read through 60-second signed links.
 * Limits mirror the `vendor-documents` bucket (tests/db checks this).
 */
export const VENDOR_DOCUMENT_BUCKET = "vendor-documents";
export const VENDOR_DOCUMENT_MAX_BYTES = 5 * 1024 * 1024;
/** How long an admin's signed link works. */
export const VENDOR_DOCUMENT_LINK_SECONDS = 60;

export const VENDOR_DOCUMENT_EXTENSIONS = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
} as const;

export type VendorDocumentMimeType = keyof typeof VENDOR_DOCUMENT_EXTENSIONS;

export const VENDOR_DOCUMENT_MIME_TYPES = Object.keys(VENDOR_DOCUMENT_EXTENSIONS) as VendorDocumentMimeType[];

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const PATH_PATTERN = new RegExp(`^(${UUID})/[A-Za-z0-9_-]{1,64}\\.(jpg|png|webp|pdf)$`);

export function isVendorDocumentMimeType(value: string): value is VendorDocumentMimeType {
  return Object.hasOwn(VENDOR_DOCUMENT_EXTENSIONS, value);
}

/** Returns a message for the user, or null when the file is acceptable. */
export function validateVendorDocumentFile(file: { type: string; size: number }): string | null {
  if (!isVendorDocumentMimeType(file.type)) return "Upload a JPG, PNG, WebP or PDF file.";
  if (file.size <= 0) return "That file is empty.";
  if (file.size > VENDOR_DOCUMENT_MAX_BYTES) {
    return `Files must be smaller than ${VENDOR_DOCUMENT_MAX_BYTES / (1024 * 1024)} MB.`;
  }
  return null;
}

export function buildVendorDocumentPath(
  userId: string,
  mimeType: VendorDocumentMimeType,
  fileId: string = crypto.randomUUID(),
): string {
  return `${userId}/${fileId}.${VENDOR_DOCUMENT_EXTENSIONS[mimeType]}`;
}

/** Returns the owner's user id when the path has the expected shape, else null. */
export function parseVendorDocumentPath(path: string): { userId: string; extension: string } | null {
  const match = PATH_PATTERN.exec(path);
  return match ? { userId: match[1], extension: match[2] } : null;
}
