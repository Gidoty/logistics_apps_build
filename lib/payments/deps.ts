import "server-only";
import { getAppUrl } from "@/lib/env";
import { userFacingDbError } from "@/lib/db-errors";
import type { Json } from "@/lib/supabase/database.types";
import { createServiceClient } from "@/lib/supabase/service";
import type { PricingSnapshot } from "@/lib/pricing/types";
import { getPaystackConfig } from "./config";
import { PaystackProvider } from "./paystack";
import type { PayableOrder, StartPaymentDeps } from "./start";

/** Loads an order with the quote it is paid against, and its snapshot (admin-only data, so the service role). */
export async function loadPayableOrder(orderId: string): Promise<PayableOrder | null> {
  const { data, error } = await createServiceClient()
    .from("orders")
    .select(
      "id, buyer_id, status, quotes(id, status, total_minor, currency, expires_at, version, snapshot:quote_pricing_snapshots(snapshot))",
    )
    .eq("id", orderId)
    .maybeSingle();
  if (error) throw new Error(`Could not load the order: ${error.message}`);
  if (!data) return null;
  const latest = [...data.quotes]
    .filter((quote) => quote.status === "sent" || quote.status === "accepted")
    .sort((a, b) => b.version - a.version)[0];
  return {
    id: data.id,
    buyerId: data.buyer_id,
    status: data.status,
    quote: latest
      ? {
          id: latest.id,
          status: latest.status,
          totalMinor: latest.total_minor,
          currency: latest.currency,
          expiresAt: latest.expires_at,
          snapshot: latest.snapshot ? (latest.snapshot.snapshot as unknown as PricingSnapshot) : null,
        }
      : null,
  };
}

export function createStartPaymentDeps(): StartPaymentDeps {
  const db = createServiceClient();
  const config = getPaystackConfig();
  return {
    loadOrder: loadPayableOrder,
    async createPayment({ orderId, buyerId, amountMinor, quote, note }) {
      const { data, error } = await db.rpc("create_payment", {
        _order_id: orderId,
        _buyer: buyerId,
        _amount_minor: amountMinor,
        _display_currency: quote.currency,
        _display_amount_minor: quote.totalMinor,
        _fx_note: note as unknown as Json,
      });
      if (error)
        throw new Error(userFacingDbError(error, "We could not start the payment. Please try again."));
      return data;
    },
    async markFailed(paymentId) {
      await db.rpc("mark_payment_status", { _payment_id: paymentId, _status: "failed" });
    },
    provider: new PaystackProvider(config.secretKey, config.apiBase),
    callbackUrl: (paymentId) => `${getAppUrl()}/pay/callback?reference=${encodeURIComponent(paymentId)}`,
    now: () => new Date(),
  };
}
