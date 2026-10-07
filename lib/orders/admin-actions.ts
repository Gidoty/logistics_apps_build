"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/session";
import { userFacingDbError } from "@/lib/db-errors";
import { createClient } from "@/lib/supabase/server";
import { createQuoteSchema, fieldErrorsFromIssues } from "./quote-lines";
import { declineOrderSchema } from "./schemas";

export type AdminResult =
  { ok: true; message: string } | { ok: false; message: string; fieldErrors?: Record<string, string[]> };

function refresh(orderId: string) {
  revalidatePath("/admin/quotes");
  revalidatePath(`/admin/quotes/${orderId}`);
  revalidatePath("/account/orders");
  revalidatePath(`/account/orders/${orderId}`);
}

/**
 * Sends a quote, or a revision when one is already waiting. The total is
 * worked out here and again in the database from the lines; nothing the
 * browser sends as a total is used.
 */
export async function sendQuote(input: unknown): Promise<AdminResult> {
  await requireAdmin("/admin/quotes");
  const orderId =
    typeof input === "object" && input !== null && "orderId" in input ? String(input.orderId) : "";

  const supabase = await createClient();
  const { data: order, error } = await supabase
    .from("orders")
    .select("id, status, max_budget_minor, buyer_currency, store_domain_id, corridor_id")
    .eq("id", orderId)
    .maybeSingle();
  if (error || !order) return { ok: false, message: "Order not found." };
  if (order.status !== "quote_requested" && order.status !== "quoted")
    return { ok: false, message: "This order is not waiting for a quote." };

  const [currency, corridors] = await Promise.all([
    supabase.from("currencies").select("minor_unit_digits").eq("code", order.buyer_currency).maybeSingle(),
    supabase.from("corridors").select("id").eq("active", true),
  ]);
  if (!currency.data || corridors.error)
    return { ok: false, message: "We could not load the order details." };

  const parsed = createQuoteSchema({
    currencyDigits: currency.data.minor_unit_digits,
    maxBudgetMinor: order.max_budget_minor,
    needsCorridor: order.corridor_id === null,
    corridorIds: corridors.data.map((corridor) => corridor.id),
  }).safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      message: "Please fix the highlighted fields.",
      fieldErrors: fieldErrorsFromIssues(parsed.error.issues),
    };
  }
  const q = parsed.data;

  const { error: sendError } = await supabase.rpc("send_quote", {
    _order_id: q.orderId,
    _lines: q.lines.map((line) => ({ type: line.type, label: line.label, amount_minor: line.amountMinor })),
    _expires_in_hours: q.expiresInHours,
    ...(q.weightGrams !== null ? { _weight_grams: q.weightGrams } : {}),
    ...(q.internalNotes !== null ? { _internal_notes: q.internalNotes } : {}),
    ...(q.corridorId !== null ? { _corridor_id: q.corridorId } : {}),
    _confirm_over_budget: q.confirmOverBudget,
  });
  if (sendError) {
    if (sendError.hint === "over_budget")
      return {
        ok: false,
        message: sendError.message,
        fieldErrors: { confirmOverBudget: [sendError.message] },
      };
    return {
      ok: false,
      message: userFacingDbError(sendError, "We could not send the quote. Please try again."),
    };
  }

  refresh(q.orderId);
  return { ok: true, message: order.status === "quoted" ? "Revised quote sent." : "Quote sent." };
}

/** Declines a request that is still waiting for its first quote. The buyer gets the reason by email. */
export async function declineOrder(input: unknown): Promise<AdminResult> {
  await requireAdmin("/admin/quotes");
  const parsed = declineOrderSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      message: "Please fix the highlighted fields.",
      fieldErrors: fieldErrorsFromIssues(parsed.error.issues),
    };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("decline_order", {
    _order_id: parsed.data.orderId,
    _reason: parsed.data.reason,
    ...(parsed.data.note !== "" ? { _note: parsed.data.note } : {}),
  });
  if (error)
    return {
      ok: false,
      message: userFacingDbError(error, "We could not decline the request. Please try again."),
    };
  refresh(parsed.data.orderId);
  return { ok: true, message: "Request declined." };
}
