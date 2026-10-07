"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { listActiveCurrencies } from "@/lib/reference/queries";
import { CURRENCY_COOKIE } from "./viewer-currency-constants";

/** Remembers the currency a visitor chose for prices. A cookie, so it works logged out. */
export async function setViewerCurrency(formData: FormData): Promise<void> {
  const parsed = z
    .string()
    .regex(/^[A-Z]{3}$/)
    .safeParse(formData.get("currency"));
  if (!parsed.success) return;
  const allowed = (await listActiveCurrencies()).some((currency) => currency.code === parsed.data);
  if (!allowed) return;
  (await cookies()).set(CURRENCY_COOKIE, parsed.data, {
    maxAge: 60 * 60 * 24 * 365,
    path: "/",
    sameSite: "lax",
    httpOnly: false,
    secure: process.env.NODE_ENV === "production",
  });
  const returnTo = formData.get("returnTo");
  revalidatePath(
    typeof returnTo === "string" && returnTo.startsWith("/") && !returnTo.startsWith("//")
      ? returnTo
      : "/shop",
  );
}
