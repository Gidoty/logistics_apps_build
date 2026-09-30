import { describe, expect, it } from "vitest";
import {
  buildProductImagePath,
  isProductImageMimeType,
  parseProductImagePath,
  PRODUCT_IMAGE_MAX_BYTES,
  productImageUrl,
  validateProductImageFile,
} from "@/lib/storage/product-images";

const VENDOR = "6f1c2c8e-8a4b-4f7e-9d3a-2b1e5c7d9f00";
const PRODUCT = "0b9d1a52-3c4e-4a6f-8b7d-1e2f3a4b5c6d";

describe("validateProductImageFile", () => {
  it("accepts JPG, PNG and WebP up to the size limit", () => {
    for (const type of ["image/jpeg", "image/png", "image/webp"]) {
      expect(validateProductImageFile({ type, size: 1024 })).toBeNull();
    }
    expect(validateProductImageFile({ type: "image/png", size: PRODUCT_IMAGE_MAX_BYTES })).toBeNull();
  });

  it.each([
    ["svg (can carry scripts)", { type: "image/svg+xml", size: 100 }, /JPG, PNG or WebP/],
    ["gif", { type: "image/gif", size: 100 }, /JPG, PNG or WebP/],
    ["html", { type: "text/html", size: 100 }, /JPG, PNG or WebP/],
    ["empty file", { type: "image/png", size: 0 }, /empty/],
    ["too large", { type: "image/png", size: PRODUCT_IMAGE_MAX_BYTES + 1 }, /smaller than 5 MB/],
  ])("rejects %s", (_label, file, message) => {
    expect(validateProductImageFile(file)).toMatch(message);
  });
});

describe("product image paths", () => {
  it("builds vendor/product/file paths with the extension from the MIME type", () => {
    expect(buildProductImagePath(VENDOR, PRODUCT, "image/jpeg", "abc")).toBe(`${VENDOR}/${PRODUCT}/abc.jpg`);
    expect(buildProductImagePath(VENDOR, PRODUCT, "image/webp", "abc")).toBe(`${VENDOR}/${PRODUCT}/abc.webp`);
  });

  it("generates a random file name by default", () => {
    const a = buildProductImagePath(VENDOR, PRODUCT, "image/png");
    const b = buildProductImagePath(VENDOR, PRODUCT, "image/png");
    expect(a).not.toBe(b);
    expect(parseProductImagePath(a)).toEqual({ vendorId: VENDOR, productId: PRODUCT });
  });

  it("parses valid paths and rejects everything else", () => {
    expect(parseProductImagePath(`${VENDOR}/${PRODUCT}/front_1.png`)).toEqual({
      vendorId: VENDOR,
      productId: PRODUCT,
    });
    for (const bad of [
      `${VENDOR}/${PRODUCT}/../x.jpg`,
      `${VENDOR}/${PRODUCT}/sub/x.jpg`,
      `${VENDOR}/${PRODUCT}/x.html`,
      `${VENDOR}/x.jpg`,
      `not-a-uuid/${PRODUCT}/x.jpg`,
      "",
    ]) {
      expect(parseProductImagePath(bad)).toBeNull();
    }
  });

  it("recognizes allowed MIME types only", () => {
    expect(isProductImageMimeType("image/jpeg")).toBe(true);
    expect(isProductImageMimeType("toString")).toBe(false);
    expect(isProductImageMimeType("image/svg+xml")).toBe(false);
  });
});

describe("productImageUrl", () => {
  it("builds the public CDN URL and ignores a trailing slash", () => {
    const path = `${VENDOR}/${PRODUCT}/a.jpg`;
    expect(productImageUrl("https://abc.supabase.co/", path)).toBe(
      `https://abc.supabase.co/storage/v1/object/public/product-images/${path}`,
    );
  });
});
