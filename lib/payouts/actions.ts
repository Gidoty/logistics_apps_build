"use server";

import { z } from "zod";
import { requireAdmin } from "@/lib/auth/session";
import { userFacingDbError } from "@/lib/db-errors";
import { parseMoneyInput } from "@/lib/money";
import { orderIdSchema } from "@/lib/orders/schemas";
import { refreshOrderPages } from "@/lib/orders/refresh";
import { createServiceClient } from "@/lib/supabase/service";

export type ActionResult = { ok: true; message: string } | { ok: false; message: string };

const referenceSchema = z.string().trim().min(3, "Enter the bank transfer reference.").max(200);

/** The NGN amount an admin typed ("125,000.50") as kobo, or null when it is not a valid amount. */
function nairaToKobo(value: string, allowZero = false): number | null {
  const parsed = parseMoneyInput(value, 2, { allowZero });
  return parsed.ok ? parsed.minor : null;
}

/**
 * Admin records a bank transfer to the vendor (or the purchase cost of a link
 * order) and the platform fee. Money moves outside the app; this records it.
 * The database refuses anything above what is held.
 */
export async function releaseToVendor(
  orderId: string,
  amount: string,
  fee: string,
  reference: string,
): Promise<ActionResult> {
  const admin = await requireAdmin("/admin/orders");
  if (!orderIdSchema.safeParse(orderId).success) return { ok: false, message: "Order not found." };
  const amountMinor = nairaToKobo(amount);
  const feeMinor = fee.trim() === "" ? 0 : nairaToKobo(fee, true);
  if (amountMinor === null) return { ok: false, message: "Enter the amount in naira, above zero." };
  if (feeMinor === null) return { ok: false, message: "Enter the fee in naira, or leave it empty." };
  const ref = referenceSchema.safeParse(reference);
  if (!ref.success) return { ok: false, message: ref.error.issues[0]?.message ?? "Enter the reference." };

  const { error } = await createServiceClient().rpc("release_to_vendor", {
    _order_id: orderId,
    _actor: admin.id,
    _amount_minor: amountMinor,
    _fee_minor: feeMinor,
    _reference: ref.data,
  });
  if (error) return { ok: false, message: userFacingDbError(error, "We could not record the release.") };
  refreshOrderPages(orderId);
  return { ok: true, message: "Release recorded." };
}

/** Admin records that the buyer got their money back (the full held balance). */
export async function recordRefund(orderId: string, reference: string): Promise<ActionResult> {
  const admin = await requireAdmin("/admin/orders");
  if (!orderIdSchema.safeParse(orderId).success) return { ok: false, message: "Order not found." };
  const ref = z.string().trim().min(3, "Enter the refund reference.").max(200).safeParse(reference);
  if (!ref.success) return { ok: false, message: ref.error.issues[0]?.message ?? "Enter the reference." };
  const { error } = await createServiceClient().rpc("record_refund", {
    _order_id: orderId,
    _actor: admin.id,
    _reference: ref.data,
  });
  if (error) return { ok: false, message: userFacingDbError(error, "We could not record the refund.") };
  refreshOrderPages(orderId);
  return { ok: true, message: "Refund recorded. The order is now refunded." };
}
