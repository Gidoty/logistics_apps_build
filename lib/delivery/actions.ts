"use server";

import { requireAdmin } from "@/lib/auth/session";
import { userFacingDbError } from "@/lib/db-errors";
import { orderIdSchema } from "@/lib/orders/schemas";
import { refreshOrderPages } from "@/lib/orders/refresh";
import { createClient } from "@/lib/supabase/server";

export type ActionResult = { ok: true; message: string } | { ok: false; message: string };

/** Lets the recipient try again after 5 wrong codes. */
export async function unlockDeliveryCode(orderId: string): Promise<ActionResult> {
  await requireAdmin("/admin/orders");
  if (!orderIdSchema.safeParse(orderId).success) return { ok: false, message: "Order not found." };
  const { error } = await (await createClient()).rpc("unlock_delivery_code", { _order_id: orderId });
  if (error) return { ok: false, message: userFacingDbError(error, "We could not unlock the code.") };
  refreshOrderPages(orderId);
  return { ok: true, message: "Unlocked. The recipient has 5 new tries." };
}

/** Delivery confirmed without the code. A note is required and kept in the history. */
export async function adminMarkDelivered(orderId: string, note: string): Promise<ActionResult> {
  await requireAdmin("/admin/orders");
  if (!orderIdSchema.safeParse(orderId).success) return { ok: false, message: "Order not found." };
  const { error } = await (
    await createClient()
  ).rpc("admin_mark_delivered", { _order_id: orderId, _note: note.slice(0, 1000) });
  if (error)
    return { ok: false, message: userFacingDbError(error, "We could not mark the order as delivered.") };
  refreshOrderPages(orderId);
  return { ok: true, message: "Marked as delivered." };
}
