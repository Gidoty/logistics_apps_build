import "server-only";
import { CHARGE_CURRENCY, quoteTotalInNgn } from "./amount";
import { loadPayableOrder } from "./deps";
import { payableQuote } from "./start";

export type PaymentPreview =
  | { kind: "ready"; amountMinor: number; quoteCurrency: string; expiresAt: string }
  | { kind: "expired" }
  | { kind: "unavailable" };

/** What the buyer is about to be charged, for the order page. Uses the same sum as the real payment. */
export async function getPaymentPreview(orderId: string, buyerId: string): Promise<PaymentPreview> {
  const order = await loadPayableOrder(orderId);
  if (!order || order.buyerId !== buyerId || order.status !== "awaiting_payment")
    return { kind: "unavailable" };
  const quote = payableQuote(order);
  if (!quote) return { kind: "unavailable" };
  if (new Date(quote.expiresAt).getTime() <= Date.now()) return { kind: "expired" };
  try {
    const charge = quoteTotalInNgn(quote.totalMinor, quote.currency, quote.snapshot);
    return {
      kind: "ready",
      amountMinor: charge.amountMinor,
      quoteCurrency: quote.currency,
      expiresAt: quote.expiresAt,
    };
  } catch {
    return { kind: "unavailable" };
  }
}

export const NGN_FORMAT = { code: CHARGE_CURRENCY, symbol: "₦", minor_unit_digits: 2 } as const;
