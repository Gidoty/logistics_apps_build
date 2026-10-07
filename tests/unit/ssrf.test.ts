import { describe, expect, it, vi } from "vitest";
import { isBlockedAddress, isIpLiteral } from "@/lib/security/ip";
import {
  checkUrl,
  pinnedLookup,
  safeFetchHtml,
  type RawResponse,
  type SafeFetchDeps,
} from "@/lib/security/safe-fetch";

describe("isBlockedAddress", () => {
  it.each([
    "127.0.0.1",
    "10.0.0.5",
    "192.168.1.1",
    "172.16.0.1",
    "172.31.255.255",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "255.255.255.255",
    "::1",
    "::",
    "fe80::1",
    "fc00::1",
    "fd12:3456::1",
    "ff02::1",
    "::ffff:127.0.0.1",
    "::ffff:10.0.0.1",
    "::ffff:169.254.169.254",
    "64:ff9b::7f00:1",
    "[::1]",
    "fe80::1%eth0",
    "not-an-ip",
    "",
  ])("blocks %j", (address) => {
    expect(isBlockedAddress(address)).toBe(true);
  });

  it.each(["8.8.8.8", "93.184.216.34", "172.32.0.1", "2606:4700:4700::1111", "::ffff:8.8.8.8"])(
    "allows %s",
    (address) => {
      expect(isBlockedAddress(address)).toBe(false);
    },
  );

  it("recognizes IP literals in odd forms", () => {
    expect(isIpLiteral("127.0.0.1")).toBe(true);
    expect(isIpLiteral("[::1]")).toBe(true);
    expect(isIpLiteral("example.com")).toBe(false);
  });
});

describe("checkUrl", () => {
  const check = (value: string) => checkUrl(new URL(value));
  it("refuses unsafe links before any network call", () => {
    expect(check("http://example.com")).toBe("not_https");
    expect(check("https://u:p@example.com")).toBe("invalid_url");
    expect(check("https://example.com:8080")).toBe("invalid_url");
    expect(check("https://localhost")).toBe("blocked_host");
    expect(check("https://app.internal")).toBe("blocked_host");
    expect(check("https://intranet")).toBe("blocked_host");
    expect(check("https://127.0.0.1")).toBe("blocked_host");
    expect(check("https://2130706433")).toBe("blocked_host");
    expect(check("https://[::1]")).toBe("blocked_host");
  });
  it("allows a normal store link", () => {
    expect(check("https://www.aliexpress.com:443/item/1")).toBeNull();
  });
});

describe("pinnedLookup", () => {
  it("answers only with the checked addresses", () => {
    const lookup = pinnedLookup(["93.184.216.34", "2606:4700::1"]);
    const single = vi.fn();
    lookup("evil.test", {}, single);
    expect(single).toHaveBeenCalledWith(null, "93.184.216.34", 4);
    const all = vi.fn();
    lookup("evil.test", { all: true }, all);
    expect(all).toHaveBeenCalledWith(null, [
      { address: "93.184.216.34", family: 4 },
      { address: "2606:4700::1", family: 6 },
    ]);
  });
  it("errors when there is nothing to connect to", () => {
    const callback = vi.fn();
    pinnedLookup([])("x.test", {}, callback);
    expect(callback.mock.calls[0][0]).toBeInstanceOf(Error);
  });
});

function streamOf(...parts: (string | Uint8Array)[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const part of parts) controller.enqueue(typeof part === "string" ? encoder.encode(part) : part);
      controller.close();
    },
  });
}

function response(
  status: number,
  headers: Record<string, string>,
  body: ReadableStream<Uint8Array> | null = null,
): RawResponse {
  return {
    status,
    header: (name) => headers[name.toLowerCase()] ?? null,
    body,
    close: () => undefined,
  };
}

const PUBLIC = async () => ["93.184.216.34"];
const HTML = { "content-type": "text/html; charset=utf-8" };

function deps(overrides: Partial<SafeFetchDeps>): Partial<SafeFetchDeps> {
  return { resolve: PUBLIC, ...overrides };
}

describe("safeFetchHtml", () => {
  it("fetches a page and pins the checked addresses", async () => {
    const request = vi.fn<SafeFetchDeps["request"]>(async () =>
      response(200, HTML, streamOf("<html>ok</html>")),
    );
    const result = await safeFetchHtml("https://shop.test/item", { deps: deps({ request }) });
    expect(result).toEqual({
      ok: true,
      text: "<html>ok</html>",
      finalUrl: "https://shop.test/item",
      truncated: false,
    });
    expect(request.mock.calls[0][1]).toEqual(["93.184.216.34"]);
  });

  it.each([
    ["http://shop.test", "not_https"],
    ["https://localhost/x", "blocked_host"],
    ["https://127.0.0.1/x", "blocked_host"],
    ["https://10.0.0.5/x", "blocked_host"],
    ["https://192.168.1.1/x", "blocked_host"],
    ["https://169.254.169.254/latest/meta-data", "blocked_host"],
    ["nonsense", "invalid_url"],
  ])("refuses %s", async (url, reason) => {
    const request = vi.fn();
    expect(await safeFetchHtml(url, { deps: deps({ request }) })).toEqual({ ok: false, reason });
    expect(request).not.toHaveBeenCalled();
  });

  it("refuses a host name that resolves to a private address", async () => {
    const request = vi.fn();
    const result = await safeFetchHtml("https://sneaky.test/x", {
      deps: { resolve: async () => ["10.0.0.5"], request },
    });
    expect(result).toEqual({ ok: false, reason: "blocked_address" });
    expect(request).not.toHaveBeenCalled();
  });

  it("refuses when any one address is private", async () => {
    const result = await safeFetchHtml("https://mixed.test/x", {
      deps: { resolve: async () => ["93.184.216.34", "127.0.0.1"], request: vi.fn() },
    });
    expect(result).toEqual({ ok: false, reason: "blocked_address" });
  });

  it("reports DNS failure and empty answers", async () => {
    expect(
      await safeFetchHtml("https://a.test/x", {
        deps: {
          resolve: async () => {
            throw new Error("nxdomain");
          },
        },
      }),
    ).toEqual({ ok: false, reason: "dns_failed" });
    expect(await safeFetchHtml("https://a.test/x", { deps: { resolve: async () => [] } })).toEqual({
      ok: false,
      reason: "dns_failed",
    });
  });

  it("follows a safe redirect", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(response(302, { location: "/final" }))
      .mockResolvedValueOnce(response(200, HTML, streamOf("done")));
    const result = await safeFetchHtml("https://shop.test/start", { deps: deps({ request }) });
    expect(result).toMatchObject({ ok: true, finalUrl: "https://shop.test/final", text: "done" });
  });

  it("refuses a redirect to a private address", async () => {
    const request = vi.fn().mockResolvedValueOnce(response(302, { location: "https://127.0.0.1/admin" }));
    const result = await safeFetchHtml("https://shop.test/start", { deps: deps({ request }) });
    expect(result).toEqual({ ok: false, reason: "blocked_host" });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("refuses a redirect to a host that resolves privately", async () => {
    const request = vi.fn().mockResolvedValueOnce(response(301, { location: "https://inner.test/" }));
    const resolve = async (host: string) => (host === "inner.test" ? ["192.168.0.9"] : ["93.184.216.34"]);
    const result = await safeFetchHtml("https://shop.test/", { deps: { resolve, request } });
    expect(result).toEqual({ ok: false, reason: "blocked_address" });
  });

  it("refuses a redirect to http", async () => {
    const request = vi.fn().mockResolvedValueOnce(response(302, { location: "http://shop.test/plain" }));
    expect(await safeFetchHtml("https://shop.test/", { deps: deps({ request }) })).toEqual({
      ok: false,
      reason: "not_https",
    });
  });

  it("stops after 3 redirects", async () => {
    const request = vi.fn(async () => response(302, { location: "/again" }));
    const result = await safeFetchHtml("https://shop.test/", { deps: deps({ request }) });
    expect(result).toEqual({ ok: false, reason: "too_many_redirects" });
    expect(request).toHaveBeenCalledTimes(4);
  });

  it("refuses a redirect with no location", async () => {
    const request = vi.fn(async () => response(302, {}));
    expect(await safeFetchHtml("https://shop.test/", { deps: deps({ request }) })).toEqual({
      ok: false,
      reason: "bad_status",
    });
  });

  it("refuses other statuses and non-HTML", async () => {
    expect(
      await safeFetchHtml("https://shop.test/", {
        deps: deps({ request: async () => response(404, HTML) }),
      }),
    ).toEqual({ ok: false, reason: "bad_status" });
    expect(
      await safeFetchHtml("https://shop.test/", {
        deps: deps({ request: async () => response(200, { "content-type": "application/pdf" }) }),
      }),
    ).toEqual({ ok: false, reason: "not_html" });
    expect(
      await safeFetchHtml("https://shop.test/", { deps: deps({ request: async () => response(200, {}) }) }),
    ).toEqual({ ok: false, reason: "not_html" });
  });

  it("reads at most maxBytes", async () => {
    const big = new Uint8Array(5000).fill(97);
    const result = await safeFetchHtml("https://shop.test/", {
      maxBytes: 1000,
      deps: deps({ request: async () => response(200, HTML, streamOf(big)) }),
    });
    expect(result.ok && result.text.length).toBe(1000);
    expect(result.ok && result.truncated).toBe(true);
  });

  it("caps the default size at 1 MB", async () => {
    const chunk = new Uint8Array(400_000).fill(98);
    const result = await safeFetchHtml("https://shop.test/", {
      deps: deps({ request: async () => response(200, HTML, streamOf(chunk, chunk, chunk, chunk)) }),
    });
    expect(result.ok && result.text.length).toBe(1_000_000);
  });

  it("times out a slow request", async () => {
    const request = (_url: URL, _addresses: string[], signal: AbortSignal) =>
      new Promise<RawResponse>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("aborted")));
      });
    const result = await safeFetchHtml("https://shop.test/", { timeoutMs: 30, deps: deps({ request }) });
    expect(result).toEqual({ ok: false, reason: "timeout" });
  });

  it("reports a network error and always closes the response", async () => {
    expect(
      await safeFetchHtml("https://shop.test/", {
        deps: deps({
          request: async () => {
            throw new Error("reset");
          },
        }),
      }),
    ).toEqual({ ok: false, reason: "network" });

    const close = vi.fn();
    await safeFetchHtml("https://shop.test/", {
      deps: deps({ request: async () => ({ ...response(404, HTML), close }) }),
    });
    expect(close).toHaveBeenCalledTimes(1);
  });
});
