import { NextResponse } from "next/server";
import { getPaystackConfig } from "@/lib/payments/config";
import { PaystackProvider } from "@/lib/payments/paystack";
import { createPaymentStore } from "@/lib/payments/store";
import { handlePaystackWebhook } from "@/lib/payments/webhook";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Paystack's webhook. The signature is checked on the raw body first, then
 * Paystack is asked to confirm the payment before anything is recorded.
 */
export async function POST(request: Request) {
  // The body must stay exactly as received for the signature to match.
  const rawBody = await request.text();
  let config;
  try {
    config = getPaystackConfig();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Not configured" }, { status: 503 });
  }
  try {
    const result = await handlePaystackWebhook({
      rawBody,
      signature: request.headers.get("x-paystack-signature"),
      secret: config.secretKey,
      provider: new PaystackProvider(config.secretKey, config.apiBase),
      store: createPaymentStore(),
    });
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    // 500 makes Paystack try again later.
    console.error("Paystack webhook failed", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Could not process the webhook" }, { status: 500 });
  }
}
