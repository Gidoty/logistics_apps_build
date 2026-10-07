import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Tables } from "@/lib/supabase/database.types";
import { linkPreviewSchema, type LinkPreview } from "./link-preview";

/** Reads the saved preview back safely. Anything unexpected in the column counts as no preview. */
export function readStoredPreview(value: unknown): LinkPreview | null {
  const parsed = linkPreviewSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export type QuoteSummary = Pick<
  Tables<"quotes">,
  "id" | "status" | "total_minor" | "currency" | "expires_at" | "version" | "accepted_at" | "created_at"
>;
export type QuoteLineRow = Pick<
  Tables<"quote_lines">,
  "id" | "line_type" | "label" | "amount_minor" | "currency" | "sort_order"
>;
export type MessageRow = Pick<
  Tables<"order_messages">,
  "id" | "body" | "created_at" | "is_admin" | "read_at" | "sender_id"
>;

const ORDER_COLUMNS =
  "id, status, order_type, source_url, source_host, quantity, variant_notes, buyer_notes, max_budget_minor, buyer_currency, link_preview_json, decline_reason, decline_note, created_at, updated_at, corridor_id, store_domain_id";

// ---------------------------------------------------------------------------
// Buyer
// ---------------------------------------------------------------------------

export type OwnOrderRow = Pick<
  Tables<"orders">,
  "id" | "status" | "order_type" | "source_host" | "quantity" | "buyer_currency" | "created_at"
> & {
  link_preview_json: unknown;
  recipient: { full_name: string; city: string; state: string } | null;
  quotes: Pick<Tables<"quotes">, "status" | "total_minor" | "currency" | "expires_at" | "version">[];
};

export async function listOwnOrders(): Promise<OwnOrderRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("orders")
    .select(
      "id, status, order_type, source_host, quantity, buyer_currency, created_at, link_preview_json, recipient:recipients(full_name, city, state), quotes(status, total_minor, currency, expires_at, version)",
    )
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw new Error(`Could not load orders: ${error.message}`);
  return data;
}

export type OwnOrderDetail = {
  order: Pick<
    Tables<"orders">,
    | "id"
    | "status"
    | "order_type"
    | "source_url"
    | "source_host"
    | "quantity"
    | "variant_notes"
    | "buyer_notes"
    | "max_budget_minor"
    | "buyer_currency"
    | "decline_reason"
    | "decline_note"
    | "created_at"
  >;
  preview: LinkPreview | null;
  recipient: Pick<
    Tables<"recipients">,
    "full_name" | "phone" | "address_line" | "city" | "state" | "landmark" | "email"
  > | null;
  /** The latest quote the buyer may see (older revisions are hidden by row security). */
  quote: (QuoteSummary & { lines: QuoteLineRow[] }) | null;
  messages: MessageRow[];
};

/**
 * One order for its buyer. A quote that ran out of time is marked expired
 * first, so the page never shows a live countdown for a dead quote.
 */
export async function getOwnOrder(orderId: string): Promise<OwnOrderDetail | null> {
  const supabase = await createClient();
  // Ignored on failure: the page still loads and the database rechecks on accept.
  await supabase.rpc("expire_quote_if_due", { _order_id: orderId });

  const { data, error } = await supabase
    .from("orders")
    .select(
      `${ORDER_COLUMNS}, link_preview_json,
       recipient:recipients(full_name, phone, address_line, city, state, landmark, email),
       quotes(id, status, total_minor, currency, expires_at, version, accepted_at, created_at,
              lines:quote_lines(id, line_type, label, amount_minor, currency, sort_order))`,
    )
    .eq("id", orderId)
    .maybeSingle();
  if (error) throw new Error(`Could not load the order: ${error.message}`);
  if (!data) return null;

  const messages = await listMessages(orderId);
  const latest = [...data.quotes].sort((a, b) => b.version - a.version)[0] ?? null;
  const { quotes: _quotes, recipient, link_preview_json, ...order } = data;
  void _quotes;
  return {
    order,
    preview: readStoredPreview(link_preview_json),
    recipient,
    quote: latest
      ? { ...latest, lines: [...latest.lines].sort((a, b) => a.sort_order - b.sort_order) }
      : null,
    messages,
  };
}

export async function listMessages(orderId: string): Promise<MessageRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("order_messages")
    .select("id, body, created_at, is_admin, read_at, sender_id")
    .eq("order_id", orderId)
    .order("created_at", { ascending: true })
    .limit(200);
  if (error) throw new Error(`Could not load messages: ${error.message}`);
  return data;
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

export type QuoteQueueRow = {
  id: string;
  created_at: string;
  source_host: string | null;
  quantity: number;
  buyer_currency: string;
  max_budget_minor: number | null;
  store_domain_id: string | null;
  link_preview_json: unknown;
  buyer: { full_name: string; email: string | null } | null;
  recipient: { city: string; state: string } | null;
  store: { display_name: string } | null;
  unreadFromBuyer: boolean;
};

export type QueueFilters = { unknownStore?: boolean; unreadOnly?: boolean };

/** Link orders waiting for a quote, oldest first. Admin only (row security). */
export async function listQuoteQueue(filters: QueueFilters = {}): Promise<QuoteQueueRow[]> {
  const supabase = await createClient();
  let query = supabase
    .from("orders")
    .select(
      "id, created_at, source_host, quantity, buyer_currency, max_budget_minor, store_domain_id, link_preview_json, buyer:profiles!orders_buyer_id_fkey(full_name, email), recipient:recipients(city, state), store:store_domains(display_name)",
    )
    .eq("order_type", "link")
    .eq("status", "quote_requested")
    .order("created_at", { ascending: true })
    .limit(200);
  if (filters.unknownStore) query = query.is("store_domain_id", null);
  const { data, error } = await query;
  if (error) throw new Error(`Could not load the quote queue: ${error.message}`);

  const ids = data.map((row) => row.id);
  const unread = new Set<string>();
  if (ids.length > 0) {
    const messages = await supabase
      .from("order_messages")
      .select("order_id")
      .in("order_id", ids)
      .eq("is_admin", false)
      .is("read_at", null);
    if (messages.error) throw new Error(`Could not load messages: ${messages.error.message}`);
    for (const message of messages.data) unread.add(message.order_id);
  }

  const rows = data.map((row) => ({ ...row, unreadFromBuyer: unread.has(row.id) }));
  return filters.unreadOnly ? rows.filter((row) => row.unreadFromBuyer) : rows;
}

export type AdminQuoteDetail = {
  order: OwnOrderDetail["order"] & { corridor_id: string | null; store_domain_id: string | null };
  buyer: { full_name: string; email: string | null; phone: string | null } | null;
  preview: LinkPreview | null;
  store: { display_name: string; supported: boolean } | null;
  recipient: OwnOrderDetail["recipient"];
  quotes: (QuoteSummary & {
    lines: QuoteLineRow[];
    weight_estimate_grams: number | null;
    internal_notes: string | null;
  })[];
  messages: MessageRow[];
  corridors: { id: string; name: string }[];
  currency: { code: string; symbol: string; minor_unit_digits: number } | null;
};

export async function getAdminQuoteDetail(orderId: string): Promise<AdminQuoteDetail | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("orders")
    .select(
      `${ORDER_COLUMNS}, link_preview_json,
       buyer:profiles!orders_buyer_id_fkey(full_name, email, phone),
       recipient:recipients(full_name, phone, address_line, city, state, landmark, email),
       store:store_domains(display_name, supported),
       quotes(id, status, total_minor, currency, expires_at, version, accepted_at, created_at, weight_estimate_grams,
              lines:quote_lines(id, line_type, label, amount_minor, currency, sort_order),
              notes:quote_internal_notes(notes))`,
    )
    .eq("id", orderId)
    .maybeSingle();
  if (error) throw new Error(`Could not load the order: ${error.message}`);
  if (!data) return null;

  const [messages, corridors, currency] = await Promise.all([
    listMessages(orderId),
    supabase.from("corridors").select("id, name").eq("active", true).order("name"),
    supabase
      .from("currencies")
      .select("code, symbol, minor_unit_digits")
      .eq("code", data.buyer_currency)
      .maybeSingle(),
  ]);
  if (corridors.error) throw new Error(`Could not load routes: ${corridors.error.message}`);

  const { quotes, buyer, recipient, store, link_preview_json, ...order } = data;
  return {
    order,
    buyer,
    preview: readStoredPreview(link_preview_json),
    store,
    recipient,
    quotes: [...quotes]
      .sort((a, b) => b.version - a.version)
      .map(({ notes, lines, ...quote }) => ({
        ...quote,
        lines: [...lines].sort((a, b) => a.sort_order - b.sort_order),
        internal_notes: notes?.notes ?? null,
      })),
    messages,
    corridors: corridors.data,
    currency: currency.data,
  };
}
