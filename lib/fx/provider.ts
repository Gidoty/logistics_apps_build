import { z } from "zod";
import { parseScaled } from "./decimal";

/**
 * Where exchange rates come from. The rest of the app depends on this
 * interface only, so another provider is one new class.
 */
export type ProviderRates = {
  /** Provider name, saved as the rate's source. */
  source: string;
  /** 1 USD = rate units, as exact decimal text with 8 places. */
  rates: Record<string, string>;
  /** When the provider itself last updated its numbers. */
  providerUpdatedAt: Date;
};

export interface FxProvider {
  readonly name: string;
  fetchUsdRates(currencies: readonly string[]): Promise<ProviderRates>;
}

/** The provider's own numbers must be no older than this, or we do not store them. */
export const PROVIDER_MAX_AGE_HOURS = 48;

const responseSchema = z.object({
  result: z.literal("success"),
  base_code: z.literal("USD"),
  time_last_update_unix: z.number().int().positive(),
  rates: z.record(z.string(), z.number().positive().finite()),
});

export type FetchLike = (
  url: string,
  init?: { signal?: AbortSignal; headers?: Record<string, string> },
) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

/**
 * open.er-api.com: free, no API key, base USD, includes NGN. Its terms ask for
 * a link back to exchangerate-api.com, which the pricing admin page shows.
 */
export class OpenErApiProvider implements FxProvider {
  readonly name = "open.er-api.com";

  constructor(
    private readonly fetchImpl: FetchLike = (url, init) => fetch(url, init),
    private readonly now: () => Date = () => new Date(),
    private readonly timeoutMs = 10_000,
  ) {}

  async fetchUsdRates(currencies: readonly string[]): Promise<ProviderRates> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let body: unknown;
    try {
      const response = await this.fetchImpl("https://open.er-api.com/v6/latest/USD", {
        signal: controller.signal,
        headers: { accept: "application/json" },
      });
      if (!response.ok) throw new Error(`Rate provider answered with status ${response.status}`);
      body = await response.json();
    } finally {
      clearTimeout(timer);
    }

    const parsed = responseSchema.safeParse(body);
    if (!parsed.success) throw new Error("Rate provider sent an unexpected response");

    const providerUpdatedAt = new Date(parsed.data.time_last_update_unix * 1000);
    const ageHours = (this.now().getTime() - providerUpdatedAt.getTime()) / 3_600_000;
    if (ageHours > PROVIDER_MAX_AGE_HOURS) {
      throw new Error(`Rate provider data is ${Math.floor(ageHours)} hours old, so it was not stored`);
    }

    const rates: Record<string, string> = {};
    for (const code of currencies) {
      const value = parsed.data.rates[code];
      if (value === undefined) throw new Error(`Rate provider has no rate for ${code}`);
      const scaled = parseScaled(value, 8, `${code} rate`);
      if (scaled === 0n) throw new Error(`Rate provider sent a zero rate for ${code}`);
      const text = scaled.toString().padStart(9, "0");
      rates[code] = `${text.slice(0, -8)}.${text.slice(-8)}`;
    }
    return { source: this.name, rates, providerUpdatedAt };
  }
}
