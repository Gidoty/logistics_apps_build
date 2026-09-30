"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin, requireUser } from "@/lib/auth/session";
import { userFacingDbError } from "@/lib/db-errors";
import { fieldErrorsFromIssues } from "@/lib/catalog/schemas";
import { formError, formSuccess, fromZodError, readText, type FormState } from "@/lib/form-state";
import { listActiveCountries } from "@/lib/reference/queries";
import { createClient } from "@/lib/supabase/server";
import { loadProductFormOptions } from "@/lib/catalog/context";
import { getOwnVendor } from "./queries";
import {
  createVendorApplicationSchema,
  payoutDetailsSchema,
  payoutRequestTokenSchema,
  rejectionNoteSchema,
  vendorIdSchema,
  vendorReviewSchema,
} from "./schemas";

export type ApplicationResult =
  { ok: true } | { ok: false; message: string; fieldErrors?: Record<string, string[]> };

/**
 * "Become a vendor": creates a pending application for the signed-in user, or,
 * after a rejection, updates the same record and sends it back for review.
 * The ID document was already uploaded by the browser into the user's own
 * folder; the database checks the path again. The role stays buyer until an
 * admin approves.
 */
export async function submitVendorApplication(input: unknown): Promise<ApplicationResult> {
  const user = await requireUser("/account/become-vendor");
  if (user.role === "admin") return { ok: false, message: "Admin accounts cannot apply to be vendors." };

  const supabase = await createClient();
  const [countries, options, existing] = await Promise.all([
    listActiveCountries(),
    // Any country works for the category list, which does not depend on it.
    loadProductFormOptions(supabase, "NG"),
    getOwnVendor(user.id),
  ]);

  const parsed = createVendorApplicationSchema({
    countries: countries.map((country) => country.code),
    categories: options.context.categories,
    userId: user.id,
  }).safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      message: "Please fix the highlighted fields.",
      fieldErrors: fieldErrorsFromIssues(parsed.error.issues),
    };
  }
  const data = parsed.data;
  const fields = {
    business_name: data.businessName,
    country_code: data.countryCode,
    city: data.city,
    phone: data.phone,
    business_reg_number: data.businessRegNumber,
    categories: data.categories,
    id_document_path: data.documentPath,
  };

  if (!existing) {
    // Status is not sent: the database sets it to pending.
    const { error } = await supabase.from("vendors").insert({ owner_id: user.id, ...fields });
    if (error) {
      if (error.code === "23505") return { ok: false, message: "You have already applied." };
      return {
        ok: false,
        message: userFacingDbError(error, "We could not send your application. Please try again."),
      };
    }
  } else if (existing.status === "rejected") {
    const { error } = await supabase
      .from("vendors")
      .update({ ...fields, status: "pending" })
      .eq("id", existing.id);
    if (error) {
      return {
        ok: false,
        message: userFacingDbError(error, "We could not send your application. Please try again."),
      };
    }
  } else {
    return { ok: false, message: "You already have a vendor application." };
  }

  revalidatePath("/account");
  revalidatePath("/admin/vendors");
  return { ok: true };
}

/**
 * Admin: approve, reject or suspend a vendor. Approval sets the vendor to
 * approved and the owner's role to vendor in one database transaction.
 * Reject and suspend need a reason, which the vendor sees. Every action is
 * written to audit_log by the database.
 */
export async function reviewVendor(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin("/admin/vendors");
  const parsed = vendorReviewSchema.safeParse({
    vendorId: readText(formData, "vendorId"),
    intent: readText(formData, "intent"),
    reason: readText(formData, "reason"),
  });
  if (!parsed.success) return fromZodError(parsed.error);

  const { vendorId, intent, reason } = parsed.data;
  const supabase = await createClient();

  const { error } =
    intent === "approve"
      ? await supabase.rpc("approve_vendor", { _vendor_id: vendorId })
      : intent === "reject"
        ? await supabase.rpc("reject_vendor", { _vendor_id: vendorId, _reason: reason })
        : await supabase.rpc("suspend_vendor", { _vendor_id: vendorId, _note: reason });
  if (error)
    return formError(userFacingDbError(error, "That action could not be completed. Please try again."));

  revalidatePath("/admin/vendors");
  revalidatePath(`/admin/vendors/${vendorId}`);
  // Suspending or reinstating changes what the shop shows.
  revalidatePath("/shop");
  return formSuccess(
    intent === "approve"
      ? "Vendor approved."
      : intent === "reject"
        ? "Application rejected."
        : "Vendor suspended.",
  );
}

export type AdminActionResult = { ok: true } | { ok: false; error: string };

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
