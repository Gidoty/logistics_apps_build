"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { orderIdSchema } from "@/lib/orders/schemas";
import { createClient } from "@/lib/supabase/server";
import { userFacingDbError } from "@/lib/db-errors";
import { createStartPaymentDeps } from "./deps";
import { startPayment } from "./start";

export type PayResult = { ok: false; message: string };

/** Sends the buyer to Paystack's payment page. On a problem it returns a message to show. */
export async function payForOrder(orderId: string): Promise<PayResult> {
  const user = await requireUser("/account/orders");
  if (!orderIdSchema.safeParse(orderId).success) return { ok: false, message: "Order not found." };
  if (!user.email) return { ok: false, message: "Your account has no email address." };

  let result;
  try {
    result = await startPayment(orderId, { id: user.id, email: user.email }, createStartPaymentDeps());
  } catch (error) {
    console.error("Could not start payment", error instanceof Error ? error.message : error);
    return { ok: false, message: "Payments are not available right now. Please try again later." };
  }
  if (!result.ok) return { ok: false, message: result.message };
  redirect(result.url);
}

/** The buyer gives up on an unpaid order. */
export async function cancelUnpaidOrder(orderId: string): Promise<{ ok: boolean; message: string }> {
  await requireUser("/account/orders");
  if (!orderIdSchema.safeParse(orderId).success) return { ok: false, message: "Order not found." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_unpaid_order", { _order_id: orderId });
  if (error)
    return {
      ok: false,
      message: userFacingDbError(error, "We could not cancel the order. Please try again."),
    };
  revalidatePath("/account/orders");
  revalidatePath(`/account/orders/${orderId}`);
  return { ok: true, message: "Order cancelled." };
}
