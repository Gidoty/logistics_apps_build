import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import { encryptDeliveryCode, generateDeliveryCode, hashDeliveryCode } from "./crypto";

/**
 * Makes sure an order that is out for delivery has a delivery code. Safe to
 * call again: the database keeps the first code. Called after a shipment event
 * and again whenever the buyer or an admin opens the order, so a failure here
 * heals itself on the next visit.
 */
export async function ensureDeliveryCode(orderId: string): Promise<void> {
  const supabase = createServiceClient();
  const { data: order, error } = await supabase
    .from("orders")
    .select("status, public_tracking_token")
    .eq("id", orderId)
    .maybeSingle();
  if (error || !order || order.status !== "out_for_delivery") return;

  const { data: existing } = await supabase
    .from("delivery_codes")
    .select("id")
    .eq("order_id", orderId)
    .maybeSingle();
  if (existing) return;

  const code = generateDeliveryCode();
  const { error: issueError } = await supabase.rpc("issue_delivery_code", {
    _order_id: orderId,
    _hash: hashDeliveryCode(order.public_tracking_token, code),
    _ciphertext: encryptDeliveryCode(code, order.public_tracking_token),
  });
  if (issueError) console.error("Could not issue a delivery code", orderId, issueError.message);
}
