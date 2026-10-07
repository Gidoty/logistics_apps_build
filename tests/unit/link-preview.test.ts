import { describe, expect, it } from "vitest";
import {
  cleanImageUrl,
  fetchLinkPreview,
  linkPreviewSchema,
  parseOpenGraph,
} from "@/lib/orders/link-preview";

const BASE = "https://shop.test/item/1";

describe("parseOpenGraph", () => {
  it("reads title, description and image", () => {
    const html = `<html><head>
      <meta property="og:title" content="Phone &amp; case">
      <meta property="og:description" content="A good phone">
      <meta property="og:image" content="https://img.test/a.jpg">
    </head><body></body></html>`;
    expect(parseOpenGraph(html, BASE)).toEqual({
      title: "Phone & case",
      description: "A good phone",
      imageUrl: "https://img.test/a.jpg",
    });
  });

  it("resolves a relative image and upgrades nothing else", () => {
    const html = `<head><meta property="og:image" content="/pics/a.jpg"></head>`;
    expect(parseOpenGraph(html, BASE).imageUrl).toBe("https://shop.test/pics/a.jpg");
  });

  it("rejects non-https and script-like picture addresses", () => {
    expect(cleanImageUrl("http://img.test/a.jpg", BASE)).toBeNull();
    expect(cleanImageUrl("javascript:alert(1)", BASE)).toBeNull();
    expect(cleanImageUrl("data:image/png;base64,AAAA", BASE)).toBeNull();
    expect(cleanImageUrl("https://127.0.0.1/a.jpg", BASE)).toBeNull();
  });

  it("strips markup and control characters from text", () => {
    const html = `<head><meta property="og:title" content="&lt;b&gt;Hello&lt;/b&gt;\u0007 world"></head>`;
    expect(parseOpenGraph(html, BASE).title).toBe("Hello world");
  });

  it("ignores tags in comments, scripts and the body, and takes the first of each", () => {
    const html = `<head>
      <!-- <meta property="og:title" content="hidden"> -->
      <script>var x = '<meta property="og:title" content="script">';</script>
      <meta property="og:title" content="First">
      <meta property="og:title" content="Second">
    </head><body><meta property="og:image" content="https://img.test/body.jpg"></body>`;
    expect(parseOpenGraph(html, BASE)).toEqual({ title: "First", description: null, imageUrl: null });
  });

  it("caps long text", () => {
    const html = `<head><meta property="og:title" content="${"a".repeat(500)}"></head>`;
    expect(parseOpenGraph(html, BASE).title).toHaveLength(200);
  });

  it("returns nulls for a page without tags", () => {
    expect(parseOpenGraph("<html></html>", BASE)).toEqual({ title: null, description: null, imageUrl: null });
  });

  it("output always passes the save schema", () => {
    const html = `<head><meta property="og:title" content="T"><meta property="og:image" content="https://i.test/a.png"></head>`;
    expect(linkPreviewSchema.safeParse(parseOpenGraph(html, BASE)).success).toBe(true);
  });
});

describe("fetchLinkPreview", () => {
  const page = `<head><meta property="og:title" content="Nice"></head>`;
  const deps = {
    resolve: async () => ["93.184.216.34"],
    request: async () => ({
      status: 200,
      header: (name: string) => (name === "content-type" ? "text/html" : null),
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(page));
          controller.close();
        },
      }),
      close: () => undefined,
    }),
  };

  it("returns a preview when the store allows it", async () => {
    expect(await fetchLinkPreview("https://shop.test/x", { previewAllowed: true, deps })).toMatchObject({
      title: "Nice",
    });
  });
  it("does not fetch when the store does not allow previews", async () => {
    expect(await fetchLinkPreview("https://shop.test/x", { previewAllowed: false, deps })).toBeNull();
  });
  it("returns null when the fetch fails", async () => {
    const failing = { resolve: async () => ["10.0.0.1"] };
    expect(await fetchLinkPreview("https://shop.test/x", { previewAllowed: true, deps: failing })).toBeNull();
  });
});
