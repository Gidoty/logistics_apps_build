import "server-only";
import { cookies } from "next/headers";
import { getSessionUser } from "@/lib/auth/session";
import { getProfile } from "@/lib/profile/queries";
import { listActiveCurrencies, type CurrencyOption } from "@/lib/reference/queries";
import { CURRENCY_COOKIE, DEFAULT_VIEWER_CURRENCY } from "./viewer-currency-constants";

/**
 * The currency to show prices in: the visitor's choice (cookie), else the
 * signed-in user's preferred currency, else naira.
 */
export async function getViewerCurrency(): Promise<{ currency: CurrencyOption; options: CurrencyOption[] }> {
  const options = await listActiveCurrencies();
  const pick = (code: string | undefined | null) => options.find((option) => option.code === code);

  const fromCookie = pick((await cookies()).get(CURRENCY_COOKIE)?.value);
  if (fromCookie) return { currency: fromCookie, options };

  const user = await getSessionUser();
  const profile = user ? await getProfile(user.id) : null;
  const currency = pick(profile?.preferred_currency) ?? pick(DEFAULT_VIEWER_CURRENCY) ?? options[0];
  return { currency, options };
}
