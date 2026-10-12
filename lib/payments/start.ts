import { PricingError } from "@/lib/pricing/errors";
import type { PricingSnapshot } from "@/lib/pricing/types";
import { CHARGE_CURRENCY, quoteTotalInNgn, type NgnCharge } from "./amount";
import { PaymentProviderError, type PaymentProvider } from "./types";

/** The quote an order is being paid against. */
export type PayableQuote = {
  id: string;
  status: string;
  totalMinor: number;
  currency: string;
  expiresAt: string;
  snapshot: PricingSnapshot | null;
};

export type PayableOrder = {
  id: string;
  buyerId: string;
  status: string;
  quote: PayableQuote | null;
};

/** Everything start-payment needs from outside, so the logic can be tested without a database. */
export interface StartPaymentDeps {
  loadOrder(orderId: string): Promise<PayableOrder | null>;
  /** Creates the pending payment. Throws an Error with a buyer-readable message. */
  createPayment(args: {
    orderId: string;
    buyerId: string;
    amountMinor: number;
    quote: PayableQuote;
    note: NgnCharge["note"];
  }): Promise<string>;
  markFailed(paymentId: string): Promise<void>;
  provider: PaymentProvider;
  callbackUrl(paymentId: string): string;
  now(): Date;
}

export type StartPaymentResult =
  | { ok: true; url: string; paymentId: string }
  | {
      ok: false;
      message: string;
      code: "not_found" | "not_payable" | "quote_expired" | "provider" | "amount";
    };

/** The quote that can still be paid: waiting (catalog) or accepted (link order). */
export function payableQuote(order: PayableOrder): PayableQuote | null {
  return order.quote && (order.quote.status === "sent" || order.quote.status === "accepted")
    ? order.quote
    : null;
}

/**
 * Opens a payment for an order and returns the Paystack page to send the buyer
 * to. The naira amount is worked out here, on the server, from the quote and
 * its snapshot: nothing the browser sends decides what is charged.
 */
export async function startPayment(
  orderId: string,
  buyer: { id: string; email: string },
  deps: StartPaymentDeps,
): Promise<StartPaymentResult> {
  const order = await deps.loadOrder(orderId);
  if (!order || order.buyerId !== buyer.id)
    return { ok: false, code: "not_found", message: "Order not found." };
  if (order.status !== "awaiting_payment") {
    return { ok: false, code: "not_payable", message: "This order is not waiting for payment." };
  }
  const quote = payableQuote(order);
  if (!quote) return { ok: false, code: "not_payable", message: "This order has no quote to pay." };
  if (new Date(quote.expiresAt).getTime() <= deps.now().getTime()) {
    return {
      ok: false,
      code: "quote_expired",
      message: "This quote has expired. Cancel the order and ask for a new quote.",
    };
  }

  let charge: NgnCharge;
  try {
    charge = quoteTotalInNgn(quote.totalMinor, quote.currency, quote.snapshot);
  } catch (error) {
    if (error instanceof PricingError)
      return {
        ok: false,
        code: "amount",
        message: "We could not work out the amount in naira. Please contact us.",
      };
    throw error;
  }

  let paymentId: string;
  try {
    paymentId = await deps.createPayment({
      orderId,
      buyerId: buyer.id,
      amountMinor: charge.amountMinor,
      quote,
      note: charge.note,
    });
  } catch (error) {
    return {
      ok: false,
      code: "not_payable",
      message: error instanceof Error ? error.message : "We could not start the payment.",
    };
  }

  try {
    const started = await deps.provider.initialize({
      email: buyer.email,
      amountMinor: charge.amountMinor,
      currency: CHARGE_CURRENCY,
      reference: paymentId,
      callbackUrl: deps.callbackUrl(paymentId),
      metadata: { order_id: orderId, payment_id: paymentId },
    });
    return { ok: true, url: started.authorizationUrl, paymentId };
  } catch (error) {
    await deps.markFailed(paymentId);
    if (!(error instanceof PaymentProviderError)) throw error;
    console.error("Paystack initialize failed:", error.message);
    return { ok: false, code: "provider", message: "We could not reach the payment page. Please try again." };
  }
}
