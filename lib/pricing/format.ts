import { formatMoney, type CurrencyFormat } from "@/lib/money";

/** "5%", "NGN 5,000.00" or "USD 9.00 per kg", for the rules tables. */
export function formatRuleValue(
  rule: { calc_method: string; value: number; currency: string },
  currency: CurrencyFormat | undefined,
): string {
  if (rule.calc_method === "percent") return `${rule.value}%`;
  const amount = currency ? formatMoney(rule.value, currency) : String(rule.value);
  return rule.calc_method === "per_kg" ? `${amount} per kg` : amount;
}

export function formatBand(from: number | null, to: number | null): string {
  const kg = (grams: number) => `${grams / 1000} kg`;
  if (from === null && to === null) return "Any weight";
  if (from === null) return `Under ${kg(to as number)}`;
  if (to === null) return `${kg(from)} and over`;
  return `${kg(from)} to under ${kg(to)}`;
}
