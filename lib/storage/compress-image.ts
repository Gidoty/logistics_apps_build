/**
 * Browser-side image compression for product photos. Runs only in the browser
 * (uses canvas). Longest side 1600px, WebP, aiming for under 300 KB.
 *
 * Safari versions that cannot encode WebP fall back to JPEG with the same
 * size target; both are allowed types. Re-encoding through a canvas also drops
 * EXIF data such as GPS location.
 */
import { compressionPlan, fitWithin } from "./image-sizing";
import {
  PRODUCT_IMAGE_MAX_SIDE,
  PRODUCT_IMAGE_MAX_STORED_BYTES,
  PRODUCT_IMAGE_TARGET_BYTES,
  validateProductImageFile,
  type ProductImageMimeType,
} from "./product-images";

export type CompressedImage = {
  blob: Blob;
  mimeType: Extract<ProductImageMimeType, "image/webp" | "image/jpeg">;
  width: number;
  height: number;
};

export class ImageCompressionError extends Error {}

type Drawable = { source: ImageBitmap | HTMLImageElement; width: number; height: number; close: () => void };

async function decode(file: File): Promise<Drawable> {
  try {
    // "from-image" applies the photo's rotation, so phone photos are upright.
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
  } catch {
    const url = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      return {
        source: image,
        width: image.naturalWidth,
        height: image.naturalHeight,
        close: () => undefined,
      };
    } catch {
      throw new ImageCompressionError("That image could not be read. Try another file.");
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

async function encode(
  drawable: Drawable,
  width: number,
  height: number,
  mimeType: CompressedImage["mimeType"],
  quality: number,
): Promise<Blob> {
  const canvas =
    typeof OffscreenCanvas !== "undefined"
      ? new OffscreenCanvas(width, height)
      : document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d") as
    CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!context) throw new ImageCompressionError("Your browser cannot process images.");

  // White behind transparent pixels, so JPEG output does not turn them black.
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.drawImage(drawable.source, 0, 0, width, height);

  if (canvas instanceof OffscreenCanvas) return canvas.convertToBlob({ type: mimeType, quality });
  return new Promise((resolve, reject) => {
    (canvas as HTMLCanvasElement).toBlob(
      (blob) => (blob ? resolve(blob) : reject(new ImageCompressionError("Could not compress that image."))),
      mimeType,
      quality,
    );
  });
}

/** Validates, resizes and compresses one picked file. Throws ImageCompressionError with a user-facing message. */
export async function compressProductImage(file: File): Promise<CompressedImage> {
  const problem = validateProductImageFile(file);
  if (problem) throw new ImageCompressionError(problem);

  const drawable = await decode(file);
  try {
    const base = fitWithin(drawable.width, drawable.height, PRODUCT_IMAGE_MAX_SIDE);
    let mimeType: CompressedImage["mimeType"] = "image/webp";
    let smallest: CompressedImage | null = null;

    for (const { scale, quality } of compressionPlan()) {
      const width = Math.max(1, Math.round(base.width * scale));
      const height = Math.max(1, Math.round(base.height * scale));
      let blob = await encode(drawable, width, height, mimeType, quality);

      // The browser ignores an unsupported type and returns PNG. Switch to JPEG.
      if (mimeType === "image/webp" && blob.type !== "image/webp") {
        mimeType = "image/jpeg";
        blob = await encode(drawable, width, height, mimeType, quality);
      }

      if (blob.size <= PRODUCT_IMAGE_TARGET_BYTES) return { blob, mimeType, width, height };
      if (!smallest || blob.size < smallest.blob.size) smallest = { blob, mimeType, width, height };
    }

    if (smallest && smallest.blob.size <= PRODUCT_IMAGE_MAX_STORED_BYTES) return smallest;
    throw new ImageCompressionError("That image is too detailed to compress. Try a simpler photo.");
  } finally {
    drawable.close();
  }
}
