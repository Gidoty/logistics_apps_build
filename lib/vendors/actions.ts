"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin, requireUser } from "@/lib/auth/session";
import { formError, fromZodError, readText, type FormState } from "@/lib/form-state";
import { listActiveCountries } from "@/lib/reference/queries";
import { createClient } from "@/lib/supabase/server";
import {
  payoutDetailsSchema,
  payoutRequestTokenSchema,
  rejectionNoteSchema,
  suspensionNoteSchema,
  vendorApplicationSchema,
  vendorIdSchema,
} from "./schemas";

const UNIQUE_VIOLATION = "23505";

/**
 * "Become a vendor": creates a pending vendor record for the signed-in user.
 * The role stays buyer until an admin approves (approveVendor).
 */
export async function applyToBecomeVendor(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser("/account/become-vendor");
  if (user.role === "admin") return formError("Admin accounts cannot apply to be vendors.");

  const parsed = vendorApplicationSchema.safeParse({
    businessName: readText(formData, "businessName"),
    countryCode: readText(formData, "countryCode"),
    city: readText(formData, "city"),
  });
  if (!parsed.success) return fromZodError(parsed.error);

  const countries = await listActiveCountries();
  if (!countries.some((country) => country.code === parsed.data.countryCode)) {
    return { status: "error", fieldErrors: { countryCode: ["Choose a country from the list."] } };
  }

  const supabase = await createClient();
  // Status is not sent: the database sets it to pending.
  const { error } = await supabase.from("vendors").insert({
    owner_id: user.id,
    business_name: parsed.data.businessName,
    country_code: parsed.data.countryCode,
    city: parsed.data.city,
  });

  if (error) {
    if (error.code === UNIQUE_VIOLATION) return formError("You have already applied.");
    return formError("We could not send your application. Please try again.");
  }

  revalidatePath("/account");
  redirect("/account?applied=1");
}

export type AdminActionResult = { ok: true } | { ok: false; error: string };

/**
 * Admin: approve a vendor. Sets the vendor to approved and the owner's role
 * to vendor in one database transaction (approve_vendor). Logged to audit_log.
 * The approval screen arrives in Batch 8.
 */
export async function approveVendor(vendorId: string): Promise<AdminActionResult> {
  await requireAdmin("/admin");
  const id = vendorIdSchema.safeParse(vendorId);
  if (!id.success) return { ok: false, error: "Invalid vendor." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("approve_vendor", { _vendor_id: id.data });
  if (error) return { ok: false, error: error.message };

  revalidatePath("/admin");
  return { ok: true };
}

/** Admin: suspend a vendor. The owner goes back to the buyer role. */
export async function suspendVendor(vendorId: string, note: string): Promise<AdminActionResult> {
  await requireAdmin("/admin");
  const id = vendorIdSchema.safeParse(vendorId);
  const parsedNote = suspensionNoteSchema.safeParse(note);
  if (!id.success) return { ok: false, error: "Invalid vendor." };
  if (!parsedNote.success) return { ok: false, error: "Note is too long." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("suspend_vendor", {
    _vendor_id: id.data,
    ...(parsedNote.data ? { _note: parsedNote.data } : {}),
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath("/admin");
  return { ok: true };
}

export type PayoutRequestResult = { ok: true; requestToken: string } | { ok: false; error: string };

/**
 * Vendor: ask to change payout details. The change does not take effect until
 * an admin approves it (approvePayoutChange). Payments keep using the current,
 * approved details in the meantime.
 */
export async function requestPayoutChange(details: unknown): Promise<PayoutRequestResult> {
  await requireUser("/vendor");
  const parsed = payoutDetailsSchema.safeParse(details);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid payout details." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("request_payout_change", { _details: parsed.data });
  if (error) return { ok: false, error: error.message };

  revalidatePath("/vendor");
  return { ok: true, requestToken: data };
}

/**
 * Admin: approve a pending payout change. `requestToken` identifies the request
 * the admin reviewed (vendors.payout_change_token); if the vendor submitted a
 * newer one, this fails so nothing is approved unseen. The review screen
 * arrives in Batch 8.
 */
export async function approvePayoutChange(
  vendorId: string,
  requestToken: string,
): Promise<AdminActionResult> {
  await requireAdmin("/admin");
  const id = vendorIdSchema.safeParse(vendorId);
  const token = payoutRequestTokenSchema.safeParse(requestToken);
  if (!id.success || !token.success) return { ok: false, error: "Invalid request." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("approve_payout_change", {
    _vendor_id: id.data,
    _token: token.data,
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath("/admin");
  return { ok: true };
}

/** Admin: discard a pending payout change. The current details stay in place. */
export async function rejectPayoutChange(vendorId: string, note: string): Promise<AdminActionResult> {
  await requireAdmin("/admin");
  const id = vendorIdSchema.safeParse(vendorId);
  const parsedNote = rejectionNoteSchema.safeParse(note);
  if (!id.success) return { ok: false, error: "Invalid vendor." };
  if (!parsedNote.success) return { ok: false, error: "Note is too long." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("reject_payout_change", {
    _vendor_id: id.data,
    ...(parsedNote.data ? { _note: parsedNote.data } : {}),
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath("/admin");
  return { ok: true };
}
