import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Tables } from "@/lib/supabase/database.types";

export type CountryOption = Pick<Tables<"countries">, "code" | "name" | "phone_prefix">;
export type CurrencyOption = Pick<Tables<"currencies">, "code" | "name" | "symbol">;

export async function listActiveCountries(): Promise<CountryOption[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("countries")
    .select("code, name, phone_prefix")
    .eq("active", true)
    .order("name");
  if (error) throw new Error(`Could not load countries: ${error.message}`);
  return data;
}

export async function listActiveCurrencies(): Promise<CurrencyOption[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("currencies")
    .select("code, name, symbol")
    .eq("active", true)
    .order("code");
  if (error) throw new Error(`Could not load currencies: ${error.message}`);
  return data;
}
