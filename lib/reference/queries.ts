import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Tables } from "@/lib/supabase/database.types";

export type CountryOption = Pick<Tables<"countries">, "code" | "name" | "phone_prefix">;
export type CurrencyOption = Pick<Tables<"currencies">, "code" | "name" | "symbol" | "minor_unit_digits">;

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
    .select("code, name, symbol, minor_unit_digits")
    .eq("active", true)
    .order("code");
  if (error) throw new Error(`Could not load currencies: ${error.message}`);
  return data;
}

/** { NGN: 2, JPY: 0, ... } for parsing and showing amounts. */
export function currencyDigitsMap(
  currencies: readonly Pick<CurrencyOption, "code" | "minor_unit_digits">[],
): Record<string, number> {
  return Object.fromEntries(currencies.map((currency) => [currency.code, currency.minor_unit_digits]));
}
