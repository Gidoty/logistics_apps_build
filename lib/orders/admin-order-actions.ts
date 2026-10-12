"use server";

import { requireAdmin } from "@/lib/auth/session";
import { userFacingDbError } from "@/lib/db-errors";
import { orderIdSchema } from "@/lib/orders/schemas";
import { createClient } from "@/lib/supabase/server";
import { refreshOrderPages } from "./refresh";

export type OrderActionResult = { ok: true; message: string } | { ok: false; message: string };

/** Admin has dealt with an order flagged for review (late payment, no stock, duplicate payment). */
export async function clearOrderFlags(orderId: string, note: string): Promise<OrderActionResult> {
  await requireAdmin("/admin/orders");
  if (!orderIdSchema.safeParse(orderId).success) return { ok: false, message: "Order not found." };
  const { error } = await (
    await createClient()
  ).rpc("clear_order_flags", { _order_id: orderId, _note: note });
  if (error)
    return {
      ok: false,
      message: userFacingDbError(error, "We could not clear the flags. Please try again."),
    };
  refreshOrderPages(orderId);
  return { ok: true, message: "Flags cleared." };
}
