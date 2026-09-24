"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/session";
import { formError, formSuccess, fromZodError, readText, type FormState } from "@/lib/form-state";
import { listActiveCountries, listActiveCurrencies } from "@/lib/reference/queries";
import { createClient } from "@/lib/supabase/server";
import { profileUpdateSchema } from "./schemas";

export async function updateProfile(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser("/account");

  const parsed = profileUpdateSchema.safeParse({
    fullName: readText(formData, "fullName"),
    phone: readText(formData, "phone"),
    countryCode: readText(formData, "countryCode"),
    preferredCurrency: readText(formData, "preferredCurrency"),
  });
  if (!parsed.success) return fromZodError(parsed.error);

  const { fullName, phone, countryCode, preferredCurrency } = parsed.data;

  // Only allow values the user could pick from the form.
  const [countries, currencies] = await Promise.all([listActiveCountries(), listActiveCurrencies()]);
  if (countryCode && !countries.some((c) => c.code === countryCode)) {
    return { status: "error", fieldErrors: { countryCode: ["Choose a country from the list."] } };
  }
  if (!currencies.some((c) => c.code === preferredCurrency)) {
    return { status: "error", fieldErrors: { preferredCurrency: ["Choose a currency from the list."] } };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({
      full_name: fullName,
      phone,
      country_code: countryCode,
      preferred_currency: preferredCurrency,
    })
    .eq("id", user.id);
  if (error) return formError("We could not save your profile. Please try again.");

  revalidatePath("/account");
  return formSuccess("Profile saved.");
}
