import { describe, expect, it } from "vitest";
import { compressionPlan, fitWithin, QUALITY_STEPS, SCALE_STEPS } from "@/lib/storage/image-sizing";
import {
  isDemoImagePath,
  PRODUCT_IMAGE_MAX_ORIGINAL_BYTES,
  PRODUCT_IMAGE_MAX_PER_PRODUCT,
  PRODUCT_IMAGE_MAX_SIDE,
  PRODUCT_IMAGE_MAX_STORED_BYTES,
  PRODUCT_IMAGE_TARGET_BYTES,
  productImageUrl,
} from "@/lib/storage/product-images";
import {
  buildVendorDocumentPath,
  parseVendorDocumentPath,
  validateVendorDocumentFile,
  VENDOR_DOCUMENT_MAX_BYTES,
} from "@/lib/storage/vendor-documents";

describe("fitWithin", () => {
  it.each([
    [4000, 3000, 1600, { width: 1600, height: 1200 }],
    [3000, 4000, 1600, { width: 1200, height: 1600 }],
    [1200, 3600, 1600, { width: 533, height: 1600 }],
    [3200, 800, 1600, { width: 1600, height: 400 }],
    [1600, 1600, 1600, { width: 1600, height: 1600 }],
    [640, 480, 1600, { width: 640, height: 480 }],
    [10000, 1, 1600, { width: 1600, height: 1 }],
  ])("%d x %d inside %d", (width, height, max, expected) => {
    expect(fitWithin(width, height, max)).toEqual(expected);
  });

  it("never enlarges and always returns whole pixels of at least 1", () => {
    for (const [w, h] of [
      [1, 1],
      [99.6, 50.2],
      [5000, 7],
    ] as const) {
      const out = fitWithin(w, h, 1600);
      expect(Number.isInteger(out.width) && Number.isInteger(out.height)).toBe(true);
      expect(out.width).toBeGreaterThanOrEqual(1);
      expect(out.height).toBeGreaterThanOrEqual(1);
      expect(out.width).toBeLessThanOrEqual(Math.max(1, Math.round(w)));
    }
  });
});

describe("compressionPlan", () => {
  it("tries every quality at full size before shrinking, best first", () => {
    const plan = compressionPlan();
    expect(plan).toHaveLength(SCALE_STEPS.length * QUALITY_STEPS.length);
    expect(plan[0]).toEqual({ scale: 1, quality: 0.85 });
    expect(plan[QUALITY_STEPS.length - 1]).toEqual({ scale: 1, quality: 0.45 });
    expect(plan[QUALITY_STEPS.length]).toEqual({ scale: 0.85, quality: 0.85 });
    expect(plan.at(-1)).toEqual({ scale: 0.55, quality: 0.45 });
  });

  it("only ever lowers quality within a size, and never raises the size", () => {
    for (const step of SCALE_STEPS) expect(step).toBeLessThanOrEqual(1);
    expect([...QUALITY_STEPS]).toEqual([...QUALITY_STEPS].sort((a, b) => b - a));
    expect([...SCALE_STEPS]).toEqual([...SCALE_STEPS].sort((a, b) => b - a));
  });
});

describe("image limits", () => {
  it("match the brief: 1600px, about 300 KB target, 5 MB before compression, 6 per product", () => {
    expect(PRODUCT_IMAGE_MAX_SIDE).toBe(1600);
    expect(PRODUCT_IMAGE_TARGET_BYTES).toBeLessThanOrEqual(300 * 1024);
    expect(PRODUCT_IMAGE_MAX_ORIGINAL_BYTES).toBe(5 * 1024 * 1024);
    expect(PRODUCT_IMAGE_MAX_PER_PRODUCT).toBe(6);
  });

  it("keeps the stored limit well above the target and below the original limit", () => {
    expect(PRODUCT_IMAGE_MAX_STORED_BYTES).toBeGreaterThan(PRODUCT_IMAGE_TARGET_BYTES);
    expect(PRODUCT_IMAGE_MAX_STORED_BYTES).toBeLessThan(PRODUCT_IMAGE_MAX_ORIGINAL_BYTES);
  });
});

describe("demo image paths", () => {
  it("are served from the app itself, real ones from storage", () => {
    expect(isDemoImagePath("demo/galaxy-a15-front.webp")).toBe(true);
    expect(isDemoImagePath("demo/../secret.webp")).toBe(false);
    expect(isDemoImagePath("demo/x.exe")).toBe(false);
    expect(productImageUrl("https://x.supabase.co", "demo/galaxy-a15-front.webp")).toBe(
      "/demo/galaxy-a15-front.webp",
    );
  });
});

describe("vendor document rules", () => {
  const USER = "6f1c2c8e-8a4b-4f7e-9d3a-2b1e5c7d9f00";

  it("accepts images and PDF up to 5 MB and refuses everything else", () => {
    for (const type of ["image/jpeg", "image/png", "image/webp", "application/pdf"]) {
      expect(validateVendorDocumentFile({ type, size: 1000 })).toBeNull();
    }
    expect(
      validateVendorDocumentFile({ type: "application/pdf", size: VENDOR_DOCUMENT_MAX_BYTES }),
    ).toBeNull();
    expect(
      validateVendorDocumentFile({ type: "application/pdf", size: VENDOR_DOCUMENT_MAX_BYTES + 1 }),
    ).toMatch(/smaller than 5 MB/);
    expect(validateVendorDocumentFile({ type: "image/gif", size: 1000 })).toMatch(/JPG, PNG, WebP or PDF/);
    expect(validateVendorDocumentFile({ type: "text/html", size: 1000 })).toMatch(/JPG, PNG, WebP or PDF/);
    expect(validateVendorDocumentFile({ type: "application/pdf", size: 0 })).toBe("That file is empty.");
  });

  it("builds a path in the owner's folder, using the extension of the checked type", () => {
    expect(buildVendorDocumentPath(USER, "application/pdf", "abc")).toBe(`${USER}/abc.pdf`);
    expect(buildVendorDocumentPath(USER, "image/png", "abc")).toBe(`${USER}/abc.png`);
    const random = buildVendorDocumentPath(USER, "image/jpeg");
    expect(parseVendorDocumentPath(random)).toEqual({ userId: USER, extension: "jpg" });
  });

  it("parses only well-formed paths", () => {
    for (const bad of [
      `${USER}/a/b.pdf`,
      `${USER}/a.exe`,
      `${USER}/../a.pdf`,
      "x/a.pdf",
      "",
      `${USER}/.pdf`,
    ]) {
      expect(parseVendorDocumentPath(bad)).toBeNull();
    }
  });
});
