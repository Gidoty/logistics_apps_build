import { FX_BASE_CURRENCY } from "./convert";
import type { FxProvider } from "./provider";

/** A fetched rate that moves more than this from the last one is held back for an admin to look at. */
export const MAX_RATE_JUMP_PERCENT = 20;

export type StoredRate = { rate: string | number; spreadPercent: string | number };

/** What the refresh needs from the database. Implemented in lib/fx/store.ts. */
export interface FxStore {
  activeCurrencyCodes(): Promise<string[]>;
  /** Newest fetched (not override) USD to X row for each currency. */
  latestFetched(): Promise<Record<string, StoredRate>>;
  insertFetched(
    rows: {
      quote: string;
      rate: string;
      source: string;
      spreadPercent: string | number;
      fetchedAt: string;
    }[],
  ): Promise<void>;
}

export type RefreshResult = {
  inserted: string[];
  rejected: { currency: string; previous: string; next: string; changePercent: number }[];
  providerUpdatedAt: string;
};

/** Percent change from previous to next, as a plain number for messages only. */
function changePercent(previous: string | number, next: string): number {
  const a = Number(previous);
  const b = Number(next);
  return a === 0 ? Infinity : Math.abs(((b - a) / a) * 100);
}

/**
 * Fetches rates and stores one new row per currency, copying forward the last
 * conversion fee. A rate that jumps by more than 20 percent is not stored, so
 * a bad number can never price an order: that currency simply goes stale and
 * quoting in it stops until an admin sets an override or the market settles.
 */
export async function refreshFxRates(
  provider: FxProvider,
  store: FxStore,
  now: Date = new Date(),
): Promise<RefreshResult> {
  const codes = (await store.activeCurrencyCodes()).filter((code) => code !== FX_BASE_CURRENCY);
  const fetched = await provider.fetchUsdRates(codes);
  const previous = await store.latestFetched();

  const rows: Parameters<FxStore["insertFetched"]>[0] = [];
  const rejected: RefreshResult["rejected"] = [];
  for (const code of codes) {
    const next = fetched.rates[code];
    const before = previous[code];
    if (before) {
      const change = changePercent(before.rate, next);
      if (change > MAX_RATE_JUMP_PERCENT) {
        rejected.push({
          currency: code,
          previous: String(before.rate),
          next,
          changePercent: Math.round(change * 10) / 10,
        });
        continue;
      }
    }
    rows.push({
      quote: code,
      rate: next,
      source: fetched.source,
      spreadPercent: before ? before.spreadPercent : "0",
      fetchedAt: now.toISOString(),
    });
  }
  if (rows.length > 0) await store.insertFetched(rows);

  return {
    inserted: rows.map((row) => row.quote),
    rejected,
    providerUpdatedAt: fetched.providerUpdatedAt.toISOString(),
  };
}
