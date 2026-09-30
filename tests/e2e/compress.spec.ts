import { build } from "esbuild";
import { expect, test, type Page } from "@playwright/test";

/**
 * Runs the real browser-side image compressor (lib/storage/compress-image.ts)
 * in Chromium on generated photos: longest side 1600px, WebP, under 300 KB,
 * and the rules that refuse bad files.
 */
let bundle = "";

test.beforeAll(async () => {
  const result = await build({
    entryPoints: ["lib/storage/compress-image.ts"],
    bundle: true,
    format: "iife",
    globalName: "Compress",
    write: false,
    tsconfig: "tsconfig.json",
    target: "es2022",
  });
  bundle = result.outputFiles[0].text;
});

async function preparePage(page: Page) {
  await page.goto("about:blank");
  await page.addScriptTag({ content: bundle });
  // A helper that draws a photo-like image (gradients, shapes, light noise) and wraps it in a File.
  await page.evaluate(() => {
    (window as unknown as { makeFile: unknown }).makeFile = async (
      width: number,
      height: number,
      type: "image/jpeg" | "image/png",
      transparent = false,
    ) => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d")!;
      if (!transparent) {
        const gradient = ctx.createLinearGradient(0, 0, width, height);
        gradient.addColorStop(0, "#3b82f6");
        gradient.addColorStop(1, "#f59e0b");
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, width, height);
      }
      for (let i = 0; i < 60; i++) {
        ctx.fillStyle = `hsla(${(i * 37) % 360}, 70%, 55%, 0.6)`;
        ctx.beginPath();
        ctx.arc((i * 131) % width, (i * 197) % height, 40 + ((i * 13) % 160), 0, Math.PI * 2);
        ctx.fill();
      }
      const blob: Blob = await new Promise((resolve) => canvas.toBlob((b) => resolve(b!), type, 0.95));
      return new File([blob], type === "image/png" ? "photo.png" : "photo.jpg", { type });
    };
  });
}

type Result = { type: string; size: number; width: number; height: number; originalSize: number };

async function compress(
  page: Page,
  width: number,
  height: number,
  type = "image/jpeg",
  transparent = false,
): Promise<Result> {
  return page.evaluate(
    async ([w, h, t, transparent]) => {
      const scope = window as unknown as {
        makeFile: (w: number, h: number, t: string, transparent: boolean) => Promise<File>;
        Compress: {
          compressProductImage: (
            f: File,
          ) => Promise<{ blob: Blob; mimeType: string; width: number; height: number }>;
        };
      };
      const file = await scope.makeFile(w as number, h as number, t as string, transparent as boolean);
      const out = await scope.Compress.compressProductImage(file);
      return {
        type: out.blob.type,
        size: out.blob.size,
        width: out.width,
        height: out.height,
        originalSize: file.size,
      };
    },
    [width, height, type, transparent] as const,
  );
}

test.describe("product image compression in the browser", () => {
  test("shrinks a large phone photo to 1600px WebP under 300 KB", async ({ page }) => {
    await preparePage(page);
    const result = await compress(page, 4000, 3000);
    console.log(
      `COMPRESS 4000x3000 jpeg ${Math.round(result.originalSize / 1024)} KB -> ${result.type} ${result.width}x${result.height} ${Math.round(result.size / 1024)} KB`,
    );
    expect(result.type).toBe("image/webp");
    expect(Math.max(result.width, result.height)).toBe(1600);
    expect(result.width / result.height).toBeCloseTo(4 / 3, 1);
    expect(result.size).toBeLessThan(300_000);
    expect(result.size).toBeLessThan(result.originalSize);
  });

  test("reaches the size target on a detailed, noisy photo by lowering quality and size in steps", async ({
    page,
  }) => {
    await preparePage(page);
    const result = await page.evaluate(async () => {
      // Fine grain over a gradient, like a photo taken in low light. Hard to compress.
      const canvas = document.createElement("canvas");
      canvas.width = 3000;
      canvas.height = 2250;
      const ctx = canvas.getContext("2d")!;
      const gradient = ctx.createLinearGradient(0, 0, 3000, 2250);
      gradient.addColorStop(0, "#1e3a8a");
      gradient.addColorStop(1, "#fbbf24");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 3000, 2250);
      const pixels = ctx.getImageData(0, 0, 3000, 2250);
      let seed = 12345;
      for (let i = 0; i < pixels.data.length; i += 4) {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        const grain = ((seed >>> 24) % 41) - 20;
        pixels.data[i] = Math.max(0, Math.min(255, pixels.data[i] + grain));
        pixels.data[i + 1] = Math.max(0, Math.min(255, pixels.data[i + 1] + grain));
        pixels.data[i + 2] = Math.max(0, Math.min(255, pixels.data[i + 2] + grain));
      }
      ctx.putImageData(pixels, 0, 0);
      const blob: Blob = await new Promise((resolve) =>
        canvas.toBlob((b) => resolve(b!), "image/jpeg", 0.92),
      );
      const file = new File([blob], "night.jpg", { type: "image/jpeg" });
      const scope = window as unknown as {
        Compress: {
          compressProductImage: (
            f: File,
          ) => Promise<{ blob: Blob; mimeType: string; width: number; height: number }>;
        };
      };
      try {
        const out = await scope.Compress.compressProductImage(file);
        return {
          ok: true,
          type: out.blob.type,
          size: out.blob.size,
          width: out.width,
          height: out.height,
          originalSize: file.size,
        };
      } catch (error) {
        return { ok: false, message: (error as Error).message, originalSize: file.size };
      }
    });
    console.log(`COMPRESS noisy 3000x2250 -> ${JSON.stringify(result)}`);
    expect(result.originalSize).toBeLessThan(5 * 1024 * 1024);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Always inside the server limit of 1 MB; normally under the 300 KB target.
      expect(result.size).toBeLessThan(1024 * 1024);
      expect(result.size).toBeLessThan(300_000);
      expect(Math.max(result.width ?? 0, result.height ?? 0)).toBeLessThanOrEqual(1600);
    }
  });

  test("handles tall, wide and transparent images", async ({ page }) => {
    await preparePage(page);
    const tall = await compress(page, 1200, 3600);
    expect([tall.width, tall.height]).toEqual([533, 1600]);
    const wide = await compress(page, 3200, 800);
    expect([wide.width, wide.height]).toEqual([1600, 400]);
    const png = await compress(page, 2400, 1800, "image/png", true);
    expect(png.type).toBe("image/webp");
    expect(Math.max(png.width, png.height)).toBe(1600);
    expect(png.size).toBeLessThan(300_000);
  });

  test("never enlarges a small image", async ({ page }) => {
    await preparePage(page);
    const small = await compress(page, 640, 480);
    expect([small.width, small.height]).toEqual([640, 480]);
    expect(small.type).toBe("image/webp");
    expect(small.size).toBeLessThan(300_000);
  });

  test("falls back to JPEG when the browser cannot encode WebP", async ({ page }) => {
    await preparePage(page);
    // Pretend to be an older Safari: asking for WebP returns PNG.
    await page.evaluate(() => {
      const original = OffscreenCanvas.prototype.convertToBlob;
      OffscreenCanvas.prototype.convertToBlob = function (options?: ImageEncodeOptions) {
        return original.call(
          this,
          options?.type === "image/webp" ? { ...options, type: "image/png" } : options,
        );
      };
      const toBlob = HTMLCanvasElement.prototype.toBlob;
      HTMLCanvasElement.prototype.toBlob = function (callback, type, quality) {
        return toBlob.call(this, callback, type === "image/webp" ? "image/png" : type, quality);
      };
    });
    const result = await compress(page, 3000, 2000);
    expect(result.type).toBe("image/jpeg");
    expect(Math.max(result.width, result.height)).toBe(1600);
    expect(result.size).toBeLessThan(300_000);
  });

  test("rejects files that are the wrong type, too big, empty or not an image", async ({ page }) => {
    await preparePage(page);
    const messages = await page.evaluate(async () => {
      const { Compress } = window as unknown as {
        Compress: { compressProductImage: (f: File) => Promise<unknown> };
      };
      const attempt = async (file: File) => {
        try {
          await Compress.compressProductImage(file);
          return "accepted";
        } catch (error) {
          return (error as Error).message;
        }
      };
      return {
        svg: await attempt(
          new File(["<svg xmlns='http://www.w3.org/2000/svg'/>"], "a.svg", { type: "image/svg+xml" }),
        ),
        gif: await attempt(new File([new Uint8Array(10)], "a.gif", { type: "image/gif" })),
        pdf: await attempt(new File([new Uint8Array(10)], "a.pdf", { type: "application/pdf" })),
        tooBig: await attempt(
          new File([new Uint8Array(5 * 1024 * 1024 + 1)], "big.jpg", { type: "image/jpeg" }),
        ),
        empty: await attempt(new File([], "empty.jpg", { type: "image/jpeg" })),
        corrupt: await attempt(
          new File([new Uint8Array([1, 2, 3, 4, 5])], "broken.jpg", { type: "image/jpeg" }),
        ),
      };
    });
    expect(messages.svg).toBe("Use a JPG, PNG or WebP image.");
    expect(messages.gif).toBe("Use a JPG, PNG or WebP image.");
    expect(messages.pdf).toBe("Use a JPG, PNG or WebP image.");
    expect(messages.tooBig).toBe("Images must be smaller than 5 MB.");
    expect(messages.empty).toBe("That file is empty.");
    expect(messages.corrupt).toBe("That image could not be read. Try another file.");
  });
});
