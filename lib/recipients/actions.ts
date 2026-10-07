"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { userFacingDbError } from "@/lib/db-errors";
import { formError, fromZodError, type FormState } from "@/lib/form-state";
import { orderIdSchema } from "@/lib/orders/schemas";
import { createClient } from "@/lib/supabase/server";
import { listRegionNames } from "./queries";
import { createRecipientSchema, readRecipientFields } from "./schemas";

const FOREIGN_KEY_VIOLATION = "23503";
const RECIPIENTS_PATH = "/account/recipients";

export type SimpleResult = { ok: true; message?: string } | { ok: false; message: string };

function toRow(r: {
  fullName: string;
  phone: string;
  email: string | null;
  addressLine: string;
  city: string;
  state: string;
  landmark: string | null;
}) {
  return {
    full_name: r.fullName,
    phone: r.phone,
    email: r.email,
    address_line: r.addressLine,
    city: r.city,
    state: r.state,
    landmark: r.landmark,
    country_code: "NG",
  };
}

/** Creates a recipient, or updates one when the form carries its id. Goes back to the list on success. */
export async function saveRecipient(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireUser(RECIPIENTS_PATH);
  const idValue = formData.get("id");
  const id = typeof idValue === "string" && idValue !== "" ? idValue : null;
  if (id !== null && !orderIdSchema.safeParse(id).success) return formError("Recipient not found.");

  const states = await listRegionNames("NG");
  const parsed = createRecipientSchema(states).safeParse(readRecipientFields(formData));
  if (!parsed.success) return fromZodError(parsed.error);

  const supabase = await createClient();
  const row = toRow(parsed.data);
  const { data, error } =
    id === null
      ? await supabase.from("recipients").insert(row).select("id").single()
      : await supabase.from("recipients").update(row).eq("id", id).select("id").maybeSingle();
  if (error) return formError(userFacingDbError(error, "We could not save the recipient. Please try again."));
  if (!data) return formError("Recipient not found.");

  revalidatePath(RECIPIENTS_PATH);
  redirect(`${RECIPIENTS_PATH}?saved=1`);
}

/**
 * Deletes a recipient. One that was used in an order cannot be deleted (the
 * order keeps pointing at it), so it is archived instead: hidden from the
 * picker, still shown on the order.
 */
export async function deleteRecipient(id: string): Promise<SimpleResult> {
  await requireUser(RECIPIENTS_PATH);
  if (!orderIdSchema.safeParse(id).success) return { ok: false, message: "Recipient not found." };

  const supabase = await createClient();
  const { data, error } = await supabase.from("recipients").delete().eq("id", id).select("id").maybeSingle();
  if (error) {
    if (error.code !== FOREIGN_KEY_VIOLATION)
      return { ok: false, message: "We could not delete the recipient. Please try again." };
    const archived = await supabase.from("recipients").update({ archived: true }).eq("id", id);
    if (archived.error) return { ok: false, message: "We could not remove the recipient. Please try again." };
    revalidatePath(RECIPIENTS_PATH);
    return { ok: true, message: "This recipient is on an order, so it was archived instead of deleted." };
  }
  if (!data) return { ok: false, message: "Recipient not found." };
  revalidatePath(RECIPIENTS_PATH);
  return { ok: true, message: "Recipient deleted." };
}

export async function setRecipientArchived(id: string, archived: boolean): Promise<SimpleResult> {
  await requireUser(RECIPIENTS_PATH);
  if (!orderIdSchema.safeParse(id).success) return { ok: false, message: "Recipient not found." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("recipients")
    .update({ archived })
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error || !data) return { ok: false, message: "We could not update the recipient." };
  revalidatePath(RECIPIENTS_PATH);
  return { ok: true };
}
