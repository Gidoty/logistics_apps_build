import { describe, expect, it } from "vitest";
import {
  checkStore,
  matchStoreDomain,
  parseProductUrl,
  unsupportedStoreMessage,
  type StoreRule,
} from "@/lib/orders/store-domains";

const store = (domain: string, extra: Partial<StoreRule> = {}): StoreRule => ({
  id: domain,
  domain,
  display_name: domain,
  corridor_id: null,
  preview_allowed: true,
  supported: true,
  ...extra,
});

const STORES = [
  store("aliexpress.com", { display_name: "AliExpress" }),
  store("amazon.com", { display_name: "Amazon", supported: false }),
  store("shop.example.com"),
  store("example.com", { supported: false, display_name: "Example" }),
];

describe("matchStoreDomain", () => {
  it("matches the domain and its subdomains", () => {
    expect(matchStoreDomain("aliexpress.com", STORES)?.domain).toBe("aliexpress.com");
    expect(matchStoreDomain("m.aliexpress.com", STORES)?.domain).toBe("aliexpress.com");
    expect(matchStoreDomain("WWW.AliExpress.com.", STORES)?.domain).toBe("aliexpress.com");
  });
  it("does not match look-alikes", () => {
    expect(matchStoreDomain("evilaliexpress.com", STORES)).toBeNull();
    expect(matchStoreDomain("aliexpress.com.evil.test", STORES)).toBeNull();
  });
  it("prefers the longest match", () => {
    expect(matchStoreDomain("a.shop.example.com", STORES)?.domain).toBe("shop.example.com");
    expect(matchStoreDomain("other.example.com", STORES)?.domain).toBe("example.com");
  });
});

describe("checkStore", () => {
  it("separates supported, unsupported and unknown", () => {
    expect(checkStore("aliexpress.com", STORES).kind).toBe("supported");
    expect(checkStore("www.amazon.com", STORES).kind).toBe("unsupported");
    expect(checkStore("unknown-store.test", STORES).kind).toBe("unknown");
  });
  it("words the unsupported message clearly", () => {
    expect(unsupportedStoreMessage({ display_name: "Amazon" })).toContain("Amazon");
  });
});

describe("parseProductUrl", () => {
  it("accepts a plain https link and drops the fragment", () => {
    expect(parseProductUrl("https://www.aliexpress.com/item/100.html#reviews")).toEqual({
      ok: true,
      href: "https://www.aliexpress.com/item/100.html",
      host: "www.aliexpress.com",
    });
  });
  it("takes the first link out of pasted text", () => {
    const result = parseProductUrl("Check this out https://a.aliexpress.com/_abc  thanks!");
    expect(result).toMatchObject({ ok: true, host: "a.aliexpress.com" });
  });
  it("adds https to a bare domain", () => {
    expect(parseProductUrl("jumia.com.ng/phone")).toMatchObject({ ok: true, host: "jumia.com.ng" });
  });
  it.each([
    "",
    "   ",
    "http://aliexpress.com/item/1",
    "https://user:pw@aliexpress.com/x",
    "https://aliexpress.com:8443/x",
    "https://127.0.0.1/x",
    "https://[::1]/x",
    "https://localhost/x",
    "not a link",
    `https://aliexpress.com/${"a".repeat(2100)}`,
  ])("rejects %j", (input) => {
    expect(parseProductUrl(input).ok).toBe(false);
  });
});
