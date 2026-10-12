import "server-only";
import { getAppUrl } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { decryptDeliveryCode } from "./crypto";
import { ensureDeliveryCode } from "./issue";
import { buildWhatsAppLink } from "./whatsapp";

export type BuyerDelivery = {
  code: string;
  trackingUrl: string;
  whatsappUrl: string;
  locked: boolean;
};

export function trackingUrlFor(token: string): string {
  return `${getAppUrl()}/t/${token}`;
}

/**
 * What the buyer needs while the order is out for delivery: the code, the
 * tracking link and a WhatsApp link. Reads the order as the signed-in buyer
 * first, so it only works for their own orders; then decrypts with the service role.
 */
export async function getBuyerDelivery(orderId: string): Promise<BuyerDelivery | null> {
  const supabase = await createClient();
  const { data: order } = await supabase
    .from("orders")
    .select("id, status, public_tracking_token, recipient:recipients(full_name, phone)")
    .eq("id", orderId)
    .maybeSingle();
  if (!order || order.status !== "out_for_delivery") return null;

  await ensureDeliveryCode(order.id);
  const { data: row } = await createServiceClient()
    .from("delivery_codes")
    .select("code_ciphertext, locked_at")
    .eq("order_id", order.id)
    .maybeSingle();
  if (!row) return null;
  const code = decryptDeliveryCode(row.code_ciphertext, order.public_tracking_token);
  if (!code) return null;

  const trackingUrl = trackingUrlFor(order.public_tracking_token);
  return {
    code,
    trackingUrl,
    locked: row.locked_at !== null,
    whatsappUrl: buildWhatsAppLink({
      recipientPhone: order.recipient?.phone ?? null,
      recipientFirstName: order.recipient?.full_name.trim().split(/\s+/)[0] ?? "there",
      trackingUrl,
      code,
    }),
  };
}

/** For the admin order page: is the code locked, and how many tries were used. Never the code itself. */
export async function getDeliveryCodeState(orderId: string) {
  const { data } = await createServiceClient()
    .from("delivery_codes")
    .select("attempts, locked_at")
    .eq("order_id", orderId)
    .maybeSingle();
  return data ? { attempts: data.attempts, locked: data.locked_at !== null } : null;
}
