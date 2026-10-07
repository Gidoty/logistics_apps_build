import { describe, expect, it, vi } from "vitest";
import { isAuthorizedCron } from "@/lib/fx/cron-auth";
import { OpenErApiProvider, type FetchLike } from "@/lib/fx/provider";
import { refreshFxRates, type FxStore, type StoredRate } from "@/lib/fx/refresh";

const NOW = new Date("2026-10-20T12:00:00Z");
const unix = (hoursAgo: number) => Math.floor((NOW.getTime() - hoursAgo * 3_600_000) / 1000);

function responding(body: unknown, ok = true, status = 200): FetchLike {
  return async () => ({ ok, status, json: async () => body });
}

const goodBody = (extra: Record<string, unknown> = {}) => ({
  result: "success",
  base_code: "USD",
  time_last_update_unix: unix(3),
  rates: { USD: 1, NGN: 1453.7, GBP: 0.7612, CNY: 7.1234 },
  ...extra,
});

describe("OpenErApiProvider", () => {
  it("returns rates as exact 8-place text", async () => {
    const provider = new OpenErApiProvider(responding(goodBody()), () => NOW);
    const result = await provider.fetchUsdRates(["NGN", "GBP", "CNY"]);
    expect(result.source).toBe("open.er-api.com");
    expect(result.rates).toEqual({ NGN: "1453.70000000", GBP: "0.76120000", CNY: "7.12340000" });
    expect(result.providerUpdatedAt.toISOString()).toBe(new Date(unix(3) * 1000).toISOString());
  });

  it.each([
    ["an HTTP error", responding({}, false, 500), /status 500/],
    ["an error result", responding(goodBody({ result: "error" })), /unexpected/],
    ["another base currency", responding(goodBody({ base_code: "EUR" })), /unexpected/],
    ["a negative rate", responding(goodBody({ rates: { USD: 1, NGN: -1, GBP: 1, CNY: 1 } })), /unexpected/],
    ["a missing currency", responding(goodBody({ rates: { USD: 1, NGN: 1500 } })), /no rate for GBP/],
    ["old provider data", responding(goodBody({ time_last_update_unix: unix(60) })), /hours old/],
    ["garbage", responding("<html>"), /unexpected/],
  ])("refuses %s", async (_name, fetchImpl, message) => {
    const provider = new OpenErApiProvider(fetchImpl, () => NOW);
    await expect(provider.fetchUsdRates(["NGN", "GBP", "CNY"])).rejects.toThrow(message);
  });
});

function memoryStore(previous: Record<string, StoredRate> = {}) {
  const inserted: Parameters<FxStore["insertFetched"]>[0] = [];
  const store: FxStore = {
    activeCurrencyCodes: async () => ["NGN", "USD", "GBP", "CNY"],
    latestFetched: async () => previous,
    insertFetched: async (rows) => {
      inserted.push(...rows);
    },
  };
  return { store, inserted };
}

describe("refreshFxRates", () => {
  const provider = new OpenErApiProvider(responding(goodBody()), () => NOW);

  it("stores one row per non-USD currency and copies the last conversion fee forward", async () => {
    const { store, inserted } = memoryStore({
      NGN: { rate: "1450", spreadPercent: "1.5" },
      GBP: { rate: "0.76", spreadPercent: "2" },
    });
    const result = await refreshFxRates(provider, store, NOW);
    expect(result.inserted.sort()).toEqual(["CNY", "GBP", "NGN"]);
    expect(inserted.find((r) => r.quote === "NGN")).toMatchObject({
      rate: "1453.70000000",
      spreadPercent: "1.5",
    });
    expect(inserted.find((r) => r.quote === "CNY")?.spreadPercent).toBe("0"); // no earlier row
    expect(inserted.every((r) => r.fetchedAt === NOW.toISOString())).toBe(true);
  });

  it("holds back a rate that jumps by more than 20 percent", async () => {
    const { store, inserted } = memoryStore({ NGN: { rate: "1000", spreadPercent: "0" } });
    const result = await refreshFxRates(provider, store, NOW);
    expect(result.rejected).toEqual([
      { currency: "NGN", previous: "1000", next: "1453.70000000", changePercent: 45.4 },
    ]);
    expect(inserted.map((r) => r.quote).sort()).toEqual(["CNY", "GBP"]);
  });

  it("accepts a move of exactly 20 percent", async () => {
    const { store } = memoryStore({ NGN: { rate: "1211.41666667", spreadPercent: "0" } });
    const result = await refreshFxRates(provider, store, NOW);
    expect(result.rejected).toEqual([]);
  });

  it("stores nothing when the provider fails", async () => {
    const failing = new OpenErApiProvider(responding({}, false, 503), () => NOW);
    const { store, inserted } = memoryStore();
    await expect(refreshFxRates(failing, store, NOW)).rejects.toThrow();
    expect(inserted).toEqual([]);
  });
});

describe("isAuthorizedCron", () => {
  const secret = "a-long-random-secret-value-1234";
  const headers = (init: Record<string, string>) => new Headers(init);

  it("accepts the Vercel bearer header and the x-cron-secret header", () => {
    expect(isAuthorizedCron(headers({ authorization: `Bearer ${secret}` }), secret)).toBe(true);
    expect(isAuthorizedCron(headers({ "x-cron-secret": secret }), secret)).toBe(true);
  });
  it("refuses a missing, wrong or empty secret", () => {
    expect(isAuthorizedCron(headers({}), secret)).toBe(false);
    expect(isAuthorizedCron(headers({ authorization: "Bearer nope" }), secret)).toBe(false);
    expect(isAuthorizedCron(headers({ authorization: secret }), secret)).toBe(false);
    expect(isAuthorizedCron(headers({ "x-cron-secret": "" }), secret)).toBe(false);
  });
  it("refuses everything when no secret is configured", () => {
    expect(isAuthorizedCron(headers({ authorization: "Bearer " }), undefined)).toBe(false);
    expect(isAuthorizedCron(headers({ authorization: "Bearer undefined" }), undefined)).toBe(false);
    expect(isAuthorizedCron(headers({ authorization: "Bearer short" }), "short")).toBe(false);
  });
  it("is used by the route handler: no header gives 401", async () => {
    vi.stubEnv("CRON_SECRET", secret);
    const { GET } = await import("@/app/api/cron/fx/route");
    const denied = await GET(new Request("http://localhost/api/cron/fx"));
    expect(denied.status).toBe(401);
    const wrong = await GET(
      new Request("http://localhost/api/cron/fx", { headers: { authorization: "Bearer wrong" } }),
    );
    expect(wrong.status).toBe(401);
    vi.unstubAllEnvs();
  });
});
