"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth/session";
import { userFacingDbError } from "@/lib/db-errors";
import { FX_BASE_CURRENCY, resolveRate } from "@/lib/fx/convert";
import { isPricingError } from "@/lib/pricing/errors";
import { createCalcRequestSchema } from "@/lib/pricing/input";
import { loadFxRows } from "@/lib/pricing/loader";
import { loadCalcOptions } from "@/lib/pricing/options";
import { calculateFromRequest } from "@/lib/pricing/service";
import { snapshotReproduces } from "@/lib/pricing/snapshot";
import { toCalcView, type CalcView } from "@/lib/pricing/view";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/database.types";
import {
  fieldErrorsFromIssues,
  MAX_CALCULATION_AGE_MS,
  sendQuoteInputSchema,
  sumLines,
  isOverBudget,
} from "./quote-lines";
import { reconcileLines } from "./quote-reconcile";
import { declineOrderSchema } from "./schemas";

export type AdminResult =
  { ok: true; message: string } | { ok: false; message: string; fieldErrors?: Record<string, string[]> };

export type CalculateResult =
  | { ok: true; view: CalcView }
  | { ok: false; message: string; code?: string; fieldErrors?: Record<string, string[]> };

function refresh(orderId: string) {
  revalidatePath("/admin/quotes");
  revalidatePath(`/admin/quotes/${orderId}`);
  revalidatePath("/account/orders");
  revalidatePath(`/account/orders/${orderId}`);
}

const ORDER_COLUMNS =
  "id, status, order_type, quantity, max_budget_minor, buyer_currency, corridor_id, recipient:recipients(state)";

/**
 * Works out the landed cost for a link order from what the admin typed: item
 * price and currency, weight, box size and category. The quantity, buyer
 * currency and destination come from the order itself, so they cannot be
 * mistyped. Nothing is saved; the result and its snapshot go back to the form.
 */
export async function calculateQuote(input: unknown): Promise<CalculateResult> {
  await requireAdmin("/admin/quotes");
  const raw = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  const orderId = typeof raw.orderId === "string" ? raw.orderId : "";

  const supabase = await createClient();
  const { data: order, error } = await supabase
    .from("orders")
    .select(ORDER_COLUMNS)
    .eq("id", orderId)
    .maybeSingle();
  if (error || !order) return { ok: false, message: "Order not found." };
  if (order.status !== "quote_requested" && order.status !== "quoted")
    return { ok: false, message: "This order is not waiting for a quote." };
  if (!order.recipient) return { ok: false, message: "This order has no delivery address." };

  const options = await loadCalcOptions();
  const parsed = createCalcRequestSchema(options.context).safeParse({
    itemPrice: raw.itemPrice,
    itemCurrency: raw.itemCurrency,
    quantity: String(order.quantity),
    weightGrams: raw.weightGrams,
    length: raw.length,
    width: raw.width,
    height: raw.height,
    categorySlug: raw.categorySlug,
    corridorId: order.corridor_id ?? raw.corridorId,
    destinationState: order.recipient.state,
    buyerCurrency: order.buyer_currency,
    specialHandling: raw.specialHandling === true,
  });
  if (!parsed.success) {
    return {
      ok: false,
      message: "Please fix the highlighted fields.",
      fieldErrors: fieldErrorsFromIssues(parsed.error.issues),
    };
  }

  try {
    const result = await calculateFromRequest(parsed.data, { fresh: true });
    const digits = options.context.currencies[order.buyer_currency] ?? 2;
    return { ok: true, view: toCalcView(result, digits) };
  } catch (error) {
    if (isPricingError(error)) return { ok: false, code: error.code, message: error.message };
    console.error("Quote calculation failed", error);
    return { ok: false, message: "The calculation failed. Please try again." };
  }
}

/**
 * Sends a quote, or a revision when one is already waiting. The server checks
 * that the snapshot belongs to this order, is under an hour old, still
 * recalculates to the same lines, and that exchange rates are still fresh. Any
 * line the admin changed must carry a reason; the calculated amount is kept
 * as the original, where only admins can read it.
 */
export async function sendQuote(input: unknown): Promise<AdminResult> {
  await requireAdmin("/admin/quotes");
  const parsed = sendQuoteInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      message: "Please fix the highlighted fields.",
      fieldErrors: fieldErrorsFromIssues(parsed.error.issues),
    };
  }
  const q = parsed.data;
  const { snapshot } = q;

  const supabase = await createClient();
  const { data: order, error } = await supabase
    .from("orders")
    .select(ORDER_COLUMNS)
    .eq("id", q.orderId)
    .maybeSingle();
  if (error || !order) return { ok: false, message: "Order not found." };
  if (order.status !== "quote_requested" && order.status !== "quoted")
    return { ok: false, message: "This order is not waiting for a quote." };

  const stale = (message: string): AdminResult => ({ ok: false, message, fieldErrors: { lines: [message] } });
  const calculatedAt = new Date(snapshot.input.now).getTime();
  if (
    snapshot.input.buyerCurrency !== order.buyer_currency ||
    snapshot.input.quantity !== order.quantity ||
    snapshot.input.destinationState !== order.recipient?.state ||
    (order.corridor_id !== null && snapshot.input.corridor.id !== order.corridor_id)
  ) {
    return stale("This calculation is for different order details. Calculate again.");
  }
  if (Date.now() - calculatedAt > MAX_CALCULATION_AGE_MS || calculatedAt > Date.now() + 60_000) {
    return stale("This calculation is more than an hour old. Calculate again.");
  }
  if (!snapshotReproduces(snapshot)) {
    return stale("The calculation does not add up any more. Calculate again.");
  }
  try {
    const rows = await loadFxRows();
    for (const currency of snapshot.data.currencies) {
      if (currency.code !== FX_BASE_CURRENCY) resolveRate(FX_BASE_CURRENCY, currency.code, rows, new Date());
    }
  } catch (error) {
    if (isPricingError(error)) return { ok: false, message: error.message };
    throw error;
  }

  const options = await loadCalcOptions();
  const digits = options.context.currencies[order.buyer_currency];
  if (digits === undefined) return { ok: false, message: "The order's currency is not available." };
  const reconciled = reconcileLines(snapshot.output.lines, q.lines, digits);
  if (!reconciled.ok) {
    return { ok: false, message: "Please fix the quote lines.", fieldErrors: { lines: reconciled.errors } };
  }
  const total = sumLines(reconciled.lines.map((line) => ({ amountMinor: line.amount_minor })));
  if (isOverBudget(total, order.max_budget_minor) && !q.confirmOverBudget) {
    return {
      ok: false,
      message: "The total is over the buyer's budget. Tick the box to send it anyway.",
      fieldErrors: {
        confirmOverBudget: ["The total is over the buyer's budget. Tick the box to send it anyway."],
      },
    };
  }

  const dims = snapshot.input.dimensionsCm;
  const { error: sendError } = await supabase.rpc("send_quote", {
    _order_id: q.orderId,
    _lines: reconciled.lines as unknown as Json,
    _expires_in_hours: q.expiresInHours,
    _snapshot: snapshot as unknown as Json,
    _weight_grams: snapshot.input.actualWeightGrams,
    ...(q.internalNotes !== "" ? { _internal_notes: q.internalNotes } : {}),
    ...(order.corridor_id === null ? { _corridor_id: snapshot.input.corridor.id } : {}),
    _confirm_over_budget: q.confirmOverBudget,
    ...(dims
      ? { _dimensions: { length_cm: dims.length, width_cm: dims.width, height_cm: dims.height } }
      : {}),
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
