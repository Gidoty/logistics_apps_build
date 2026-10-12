import "server-only";
import type { Json } from "@/lib/supabase/database.types";
import { createServiceClient } from "@/lib/supabase/service";
import type { PaymentRecord, PaymentStore } from "./webhook";

/** The payment tables through the service role: browsers never write them. */
export function createPaymentStore(): PaymentStore {
  const db = createServiceClient();
  return {
    async findByReference(reference): Promise<PaymentRecord | null> {
      const { data, error } = await db
        .from("payments")
        .select("id, status, amount_minor, currency, order_id")
        .eq("provider", "paystack")
        .eq("provider_reference", reference)
        .maybeSingle();
      if (error) throw new Error(`Could not read the payment: ${error.message}`);
      return data
        ? {
            id: data.id,
            status: data.status,
            amountMinor: data.amount_minor,
            currency: data.currency,
            orderId: data.order_id,
          }
        : null;
    },
    async applySuccess(paymentId, paidAt, payload) {
      const { data, error } = await db.rpc("apply_successful_payment", {
        _payment_id: paymentId,
        ...(paidAt ? { _paid_at: paidAt } : {}),
        _payload: payload as Json,
      });
      if (error) throw new Error(`Could not apply the payment: ${error.message}`);
      return data;
    },
    async markStatus(paymentId, status, payload) {
      const { error } = await db.rpc("mark_payment_status", {
        _payment_id: paymentId,
        _status: status,
        _payload: payload as Json,
      });
      if (error) throw new Error(`Could not update the payment: ${error.message}`);
    },
  };
}
