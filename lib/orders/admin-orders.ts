import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Tables } from "@/lib/supabase/database.types";

/** Reads for the admin order pages. They run as the signed-in admin, so row security still applies. */

export type AdminOrderRow = Pick<
  Tables<"orders">,
  "id" | "status" | "order_type" | "created_at" | "buyer_currency" | "review_flags" | "quantity"
> & {
  buyer: { full_name: string; email: string | null } | null;
  items: { description: string }[];
};

export type LedgerSummary = {
  held_minor: number | string;
  released_minor: number | string;
  refunded_minor: number | string;
  platform_fee_minor: number | string;
  balance_minor: number | string;
  currency: string;
};

export type OrderListFilter = "attention" | "all";

export async function listOrdersForAdmin(filter: OrderListFilter): Promise<AdminOrderRow[]> {
  const supabase = await createClient();
  let query = supabase
    .from("orders")
    .select(
      "id, status, order_type, created_at, buyer_currency, review_flags, quantity, buyer:profiles!orders_buyer_id_fkey(full_name, email), items:order_items(description)",
    )
    .order("created_at", { ascending: false })
    .limit(200);
  if (filter === "attention") query = query.not("review_flags", "eq", "{}");
  const { data, error } = await query;
  if (error) throw new Error(`Could not load orders: ${error.message}`);
  return data;
}

export async function getAdminOrder(orderId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("orders")
    .select(
      `id, status, order_type, created_at, updated_at, buyer_currency, quantity, review_flags, review_flagged_at,
       source_url, source_host, public_tracking_token, vendor_id,
       buyer:profiles!orders_buyer_id_fkey(id, full_name, email, phone),
       recipient:recipients(full_name, phone, address_line, city, state, landmark),
       vendor:vendors(business_name),
       items:order_items(description, quantity, unit_price_minor, currency),
       quotes(id, status, total_minor, currency, expires_at, version),
       payments(id, status, amount_minor, currency, provider_reference, display_currency, display_amount_minor, created_at, paid_at),
       ledger:ledger_entries(id, entry_type, amount_minor, currency, reference, note, created_at)`,
    )
    .eq("id", orderId)
    .maybeSingle();
  if (error) throw new Error(`Could not load the order: ${error.message}`);
  if (!data) return null;

  const summary = await supabase.rpc("order_ledger_summary", { _order_id: orderId });
  if (summary.error) throw new Error(`Could not load the ledger: ${summary.error.message}`);
  // The generated types do not describe a function that returns a table.
  const rows = (summary.data ?? []) as LedgerSummary[];
  return { ...data, summary: rows[0] ?? null };
}

export type AdminOrder = NonNullable<Awaited<ReturnType<typeof getAdminOrder>>>;
