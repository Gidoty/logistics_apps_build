import "server-only";
import { effectiveFxRow, FX_BASE_CURRENCY, FX_MAX_AGE_HOURS, type FxRow } from "@/lib/fx/convert";
import { createClient } from "@/lib/supabase/server";
import type { Tables } from "@/lib/supabase/database.types";
import { mapFxRow } from "./loader";

/** Reads for /admin/pricing. They run as the signed-in admin, so row security still applies. */

export async function listFeeRulesForAdmin(showClosed: boolean) {
  const supabase = await createClient();
  let query = supabase
    .from("fee_rules")
    .select("*, corridor:corridors(name), zone:delivery_zones(name)")
    .order("effective_from", { ascending: false })
    .limit(500);
  if (!showClosed) query = query.is("effective_to", null);
  const { data, error } = await query;
  if (error) throw new Error(`Could not load fee rules: ${error.message}`);
  return data;
}

export async function listDutyRatesForAdmin(showClosed: boolean) {
  const supabase = await createClient();
  let query = supabase
    .from("duty_rates")
    .select("*, corridor:corridors(name)")
    .order("effective_from", { ascending: false })
    .limit(200);
  if (!showClosed) query = query.is("effective_to", null);
  const { data, error } = await query;
  if (error) throw new Error(`Could not load duty rates: ${error.message}`);
  return data;
}

export async function listZonesForAdmin(): Promise<Tables<"delivery_zones">[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("delivery_zones").select("*").order("name");
  if (error) throw new Error(`Could not load delivery zones: ${error.message}`);
  return data;
}

export type FxPairStatus = {
  quote: string;
  row: FxRow | null;
  ageHours: number | null;
  /** Older than the limit and not overridden: quotes in this currency are refused. */
  stale: boolean;
  fetchedRate: FxRow | null;
};

/** One line per currency against USD: the rate that prices it now, its age, and any override. */
export async function listFxStatus(
  currencies: readonly string[],
  now: Date = new Date(),
): Promise<FxPairStatus[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("fx_rates")
    .select("*")
    .order("fetched_at", { ascending: false })
    .limit(400);
  if (error) throw new Error(`Could not load exchange rates: ${error.message}`);
  const rows = data.map(mapFxRow);
  return currencies
    .filter((code) => code !== FX_BASE_CURRENCY)
    .map((quote) => {
      const row = effectiveFxRow(rows, FX_BASE_CURRENCY, quote, now);
      const fetched =
        rows.find((r) => r.quote === quote && r.base === FX_BASE_CURRENCY && !r.isOverride) ?? null;
      const ageHours = row ? (now.getTime() - new Date(row.fetchedAt).getTime()) / 3_600_000 : null;
      return {
        quote,
        row,
        ageHours,
        stale: !row || (!row.isOverride && (ageHours ?? 0) > FX_MAX_AGE_HOURS),
        fetchedRate: fetched,
      };
    });
}
