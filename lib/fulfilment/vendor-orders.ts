import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { OrderStatus } from "@/lib/orders/state-machine";

export type VendorOrderRow = {
  order_id: string;
  status: OrderStatus;
  created_at: string;
  quantity: number;
  item: string | null;
  recipient_city: string | null;
  supplier_reference: string | null;
  needs_review: boolean;
  proof_submitted_at: string | null;
};

/** The signed-in vendor's paid orders. The database function returns the recipient's city and nothing else about them. */
export async function listVendorOrders(): Promise<VendorOrderRow[]> {
  const { data, error } = await (await createClient()).rpc("vendor_orders");
  if (error) throw new Error(`Could not load orders: ${error.message}`);
  // The generated types do not describe a function that returns a table.
  return (data ?? []) as VendorOrderRow[];
}
