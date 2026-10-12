import { z } from "zod";
import { verifyPaystackSignature } from "./signature";
import type { PaymentProvider } from "./types";

/** What the webhook needs from the database. Implemented in lib/payments/store.ts. */
export type PaymentRecord = {
  id: string;
  status: string;
  amountMinor: number;
  currency: string;
  orderId: string;
};

export interface PaymentStore {
  findByReference(reference: string): Promise<PaymentRecord | null>;
  applySuccess(paymentId: string, paidAt: string | null, payload: unknown): Promise<string>;
  markStatus(paymentId: string, status: "failed" | "abandoned" | "mismatch", payload: unknown): Promise<void>;
}

export type WebhookResult = { status: number; body: Record<string, unknown> };

const eventSchema = z.object({
  event: z.string(),
  data: z.object({ reference: z.string().min(1).max(200) }).passthrough(),
});

/** Paystack's webhooks are small. Anything bigger is not from them. */
export const MAX_WEBHOOK_BYTES = 100_000;

/**
 * Handles a Paystack webhook.
 * 1. The signature must match the raw body, or the answer is 401 and nothing else happens.
 * 2. Only charge.success matters. Other events are acknowledged and ignored.
 * 3. A payment we already applied is acknowledged and left alone.
 * 4. Otherwise Paystack is asked directly (verify). The webhook body is never
 *    trusted: status, amount, currency and reference must match our own record.
 * 5. Only then is the payment applied, in one database transaction.
 * A wrong amount or currency puts the payment on hold for an admin and tells them.
 */
export async function handlePaystackWebhook(args: {
  rawBody: string;
  signature: string | null;
  secret: string;
  provider: PaymentProvider;
  store: PaymentStore;
}): Promise<WebhookResult> {
  const { rawBody, signature, secret, provider, store } = args;
  if (rawBody.length > MAX_WEBHOOK_BYTES || !verifyPaystackSignature(rawBody, signature, secret)) {
    return { status: 401, body: { error: "Invalid signature" } };
  }

  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return { status: 400, body: { error: "Not JSON" } };
  }
  const parsed = eventSchema.safeParse(json);
  if (!parsed.success) return { status: 400, body: { error: "Unexpected payload" } };
  if (parsed.data.event !== "charge.success") return { status: 200, body: { ok: true, ignored: "event" } };

  const reference = parsed.data.data.reference;
  const payment = await store.findByReference(reference);
  if (!payment) return { status: 200, body: { ok: true, ignored: "unknown_reference" } };
  if (payment.status === "success") return { status: 200, body: { ok: true, duplicate: true } };
  if (payment.status === "mismatch") return { status: 200, body: { ok: true, ignored: "on_hold" } };

  // A failure to reach Paystack is a 500, so Paystack sends the webhook again.
  const verified = await provider.verify(reference);

  if (verified.reference !== reference || verified.status !== "success") {
    return { status: 200, body: { ok: true, ignored: "not_successful", providerStatus: verified.status } };
  }
  if (verified.amountMinor !== payment.amountMinor || verified.currency !== payment.currency) {
    await store.markStatus(payment.id, "mismatch", verified.raw);
    return { status: 200, body: { ok: false, rejected: "amount_mismatch" } };
  }

  const outcome = await store.applySuccess(payment.id, verified.paidAt, verified.raw);
  return { status: 200, body: { ok: true, outcome } };
}
