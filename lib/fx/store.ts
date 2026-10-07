import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import { FX_BASE_CURRENCY } from "./convert";
import type { FxStore } from "./refresh";

/** The refresh job's database access, with the service role. */
export function createFxStore(): FxStore {
  const db = createServiceClient();
  return {
    async activeCurrencyCodes() {
      const { data, error } = await db.from("currencies").select("code").eq("active", true);
      if (error) throw new Error(`Could not read currencies: ${error.message}`);
      return data.map((row) => row.code);
    },
    async latestFetched() {
      const { data, error } = await db
        .from("fx_rates")
        .select("quote_currency, rate, spread_percent, fetched_at")
        .eq("base_currency", FX_BASE_CURRENCY)
        .eq("is_override", false)
        .order("fetched_at", { ascending: false })
        .limit(300);
      if (error) throw new Error(`Could not read exchange rates: ${error.message}`);
      const latest: Record<string, { rate: string | number; spreadPercent: string | number }> = {};
      for (const row of data) {
        latest[row.quote_currency] ??= { rate: row.rate, spreadPercent: row.spread_percent };
      }
      return latest;
    },
    async insertFetched(rows) {
      const { error } = await db.from("fx_rates").insert(
        rows.map((row) => ({
          base_currency: FX_BASE_CURRENCY,
          quote_currency: row.quote,
          rate: Number(row.rate),
          source: row.source,
          is_override: false,
          spread_percent: Number(row.spreadPercent),
          fetched_at: row.fetchedAt,
        })),
      );
      if (error) throw new Error(`Could not save exchange rates: ${error.message}`);
    },
  };
}
