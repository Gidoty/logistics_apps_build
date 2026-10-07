"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { requireUser } from "@/lib/auth/session";
import { userFacingDbError } from "@/lib/db-errors";
import { formError, fromZodError, type FormState } from "@/lib/form-state";
import { createRecipientSchema, readRecipientFields } from "@/lib/recipients/schemas";
import { listRegionNames } from "@/lib/recipients/queries";
import { currencyDigitsMap, listActiveCurrencies } from "@/lib/reference/queries";
import { createThrottle } from "@/lib/security/throttle";
import { createClient } from "@/lib/supabase/server";
import { fetchLinkPreview, linkPreviewSchema, type LinkPreview } from "./link-preview";
import { queueAdminNotification } from "./notifications";
import { createLinkOrderSchema, messageBodySchema, orderIdSchema } from "./schemas";
import { transitionOrder } from "./state-machine";
import { checkStore, parseProductUrl, unsupportedStoreMessage, type StoreRule } from "./store-domains";

export type SimpleResult = { ok: true; message?: string } | { ok: false; message: string };

// Best effort per server instance. The hard limits are in the database.
const previewThrottle = createThrottle(10, 60_000);
const newQuoteThrottle = createThrottle(5, 60_000);

async function loadStores(): Promise<StoreRule[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("store_directory")
    .select("id, domain, display_name, corridor_id, preview_allowed, supported");
  if (error) throw new Error(`Could not load stores: ${error.message}`);
  // The view allows nulls in its columns; rows always have them.
  return data.flatMap((row) =>
    row.id && row.domain && row.display_name
      ? [
          {
            id: row.id,
            domain: row.domain,
            display_name: row.display_name,
            corridor_id: row.corridor_id,
            preview_allowed: row.preview_allowed === true,
            supported: row.supported === true,
          },
        ]
      : [],
  );
}

export type PreviewResult =
  | { ok: true; host: string; storeName: string | null; known: boolean; preview: LinkPreview | null }
  | { ok: false; message: string };

/**
 * Shows what a pasted link is, before the buyer submits. Display only: the
 * order saves its own preview later. Only stores on our list are fetched.
 */
export async function previewLink(input: string): Promise<PreviewResult> {
  const user = await requireUser("/order/link");
  if (typeof input !== "string") return { ok: false, message: "Paste the link to the product." };
  const parsed = parseProductUrl(input);
  if (!parsed.ok) return { ok: false, message: parsed.error };
  if (!previewThrottle.allow(user.id)) return { ok: false, message: "Please wait a moment and try again." };

  const check = checkStore(parsed.host, await loadStores());
  if (check.kind === "unsupported") return { ok: false, message: unsupportedStoreMessage(check.store) };
  if (check.kind === "unknown")
    return { ok: true, host: parsed.host, storeName: null, known: false, preview: null };

  const preview = await fetchLinkPreview(parsed.href, { previewAllowed: check.store.preview_allowed });
  return { ok: true, host: parsed.host, storeName: check.store.display_name, known: true, preview };
}

/** Fetches and saves the order's preview after the response is sent. A failure never affects the order. */
async function savePreviewLater(orderId: string, buyerId: string, href: string, previewAllowed: boolean) {
  try {
    const preview = await fetchLinkPreview(href, { previewAllowed });
    const checked = linkPreviewSchema.safeParse(preview);
    if (!checked.success) return;
    const { createServiceClient } = await import("@/lib/supabase/service");
    await createServiceClient()
      .from("orders")
      .update({ link_preview_json: checked.data })
      .eq("id", orderId)
      .eq("buyer_id", buyerId);
  } catch (error) {
    console.error("Could not save link preview", orderId, error);
  }
}

function prefixErrors(errors: Record<string, string[]> | undefined, prefix: string) {
  return Object.fromEntries(Object.entries(errors ?? {}).map(([key, value]) => [`${prefix}${key}`, value]));
}

/**
 * The "Buy it for me" form. The recipient is an existing one or a new one
 * typed in the same form (recipientId "new"). Everything is checked here and
 * again by create_link_order() in the database.
 */
export async function createLinkOrder(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser("/order/link");
  const text = (name: string) => {
    const value = formData.get(name);
    return typeof value === "string" ? value : "";
  };

  const [currencies, states, stores] = await Promise.all([
    listActiveCurrencies(),
    listRegionNames("NG"),
    loadStores(),
  ]);

  const creatingRecipient = text("recipientId") === "new";
  const orderResult = createLinkOrderSchema({ currencies: currencyDigitsMap(currencies) }).safeParse({
    productUrl: text("productUrl"),
    quantity: text("quantity"),
    variantNotes: text("variantNotes"),
    buyerNotes: text("buyerNotes"),
    maxBudget: text("maxBudget"),
    buyerCurrency: text("buyerCurrency"),
    // A new recipient has no id yet; the real one replaces this below.
    recipientId: creatingRecipient ? "00000000-0000-4000-8000-000000000000" : text("recipientId"),
  });
  const recipientResult = creatingRecipient
    ? createRecipientSchema(states).safeParse(readRecipientFields(formData, "recipient_"))
    : null;

  if (!orderResult.success || (recipientResult && !recipientResult.success)) {
    const fieldErrors: Record<string, string[]> = {};
    if (!orderResult.success) Object.assign(fieldErrors, fromZodError(orderResult.error).fieldErrors);
    if (recipientResult && !recipientResult.success)
      Object.assign(fieldErrors, prefixErrors(fromZodError(recipientResult.error).fieldErrors, "recipient_"));
    return { status: "error", message: "Please fix the highlighted fields.", fieldErrors };
  }

  const input = orderResult.data;
  const check = checkStore(input.host, stores);
  if (check.kind === "unsupported") {
    return {
      status: "error",
      message: unsupportedStoreMessage(check.store),
      fieldErrors: { productUrl: [unsupportedStoreMessage(check.store)] },
    };
  }

  const supabase = await createClient();
  let recipientId = input.recipientId;
  if (recipientResult?.success) {
    const r = recipientResult.data;
    const created = await supabase
      .from("recipients")
      .insert({
        full_name: r.fullName,
        phone: r.phone,
        email: r.email,
        address_line: r.addressLine,
        city: r.city,
        state: r.state,
        landmark: r.landmark,
        country_code: "NG",
      })
      .select("id")
      .single();
    if (created.error)
      return formError(
        userFacingDbError(created.error, "We could not save the recipient. Please try again."),
      );
    recipientId = created.data.id;
  }

  const { data: orderId, error } = await supabase.rpc("create_link_order", {
    _source_url: input.sourceUrl,
    _quantity: input.quantity,
    _variant_notes: input.variantNotes ?? "",
    _buyer_notes: input.buyerNotes ?? "",
    // The function accepts null for "no budget"; the generated type does not model that.
    _max_budget_minor: input.maxBudgetMinor as number,
    _recipient_id: recipientId,
    _buyer_currency: input.buyerCurrency,
  });
  if (error) {
    if (error.hint === "unsupported_store")
      return {
        status: "error",
        message: error.message,
        fieldErrors: { productUrl: [error.message] },
      };
    return formError(userFacingDbError(error, "We could not send your request. Please try again."));
  }

  const previewAllowed = check.kind === "supported" && check.store.preview_allowed;
  after(() => savePreviewLater(orderId, user.id, input.sourceUrl, previewAllowed));

  revalidatePath("/account/orders");
  redirect(`/account/orders/${orderId}?new=1`);
}

function refreshOrder(orderId: string) {
  revalidatePath("/account/orders");
  revalidatePath(`/account/orders/${orderId}`);
  revalidatePath("/admin/quotes");
  revalidatePath(`/admin/quotes/${orderId}`);
}

function checkId(orderId: unknown): orderId is string {
  return orderIdSchema.safeParse(orderId).success;
}

/**
 * Accepts the waiting quote. The database checks the time again and, when the
 * quote has run out, marks it expired instead and answers "expired".
 */
export async function acceptQuote(orderId: string): Promise<SimpleResult & { expired?: boolean }> {
  await requireUser("/account/orders");
  if (!checkId(orderId)) return { ok: false, message: "Order not found." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("accept_quote", { _order_id: orderId });
  if (error)
    return {
      ok: false,
      message: userFacingDbError(error, "We could not accept the quote. Please try again."),
    };
  refreshOrder(orderId);
  if (data === "expired")
    return { ok: true, expired: true, message: "This quote has expired. Ask for a new one." };
  return { ok: true, message: "Quote accepted." };
}

export async function declineQuote(orderId: string): Promise<SimpleResult> {
  await requireUser("/account/orders");
  if (!checkId(orderId)) return { ok: false, message: "Order not found." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("decline_quote", { _order_id: orderId });
  if (error)
    return {
      ok: false,
      message: userFacingDbError(error, "We could not decline the quote. Please try again."),
    };
  refreshOrder(orderId);
  return { ok: true, message: "Quote declined." };
}

/** After a quote expired: puts the order back in the admin queue. Only the buyer of an expired order. */
export async function requestNewQuote(orderId: string): Promise<SimpleResult> {
  const user = await requireUser("/account/orders");
  if (!checkId(orderId)) return { ok: false, message: "Order not found." };
  if (!newQuoteThrottle.allow(user.id)) return { ok: false, message: "Please wait a moment and try again." };

  const supabase = await createClient();
  // Row security limits this read to the buyer's own orders.
  const { data: order, error } = await supabase
    .from("orders")
    .select("id, status")
    .eq("id", orderId)
    .maybeSingle();
  if (error || !order) return { ok: false, message: "Order not found." };
  if (order.status !== "quote_expired")
    return { ok: false, message: "A new quote can only be requested after the last one expired." };

  try {
    await transitionOrder(orderId, "quote_requested", user.id, "Buyer asked for a new quote");
  } catch {
    return { ok: false, message: "We could not send your request. Please try again." };
  }
  await queueAdminNotification("quote_requested", { order_id: orderId, requote: true });
  refreshOrder(orderId);
  return { ok: true, message: "We have asked for a new quote." };
}

/** A message on an order, from its buyer or from an admin. The database sets the sender and checks access. */
export async function postOrderMessage(orderId: string, body: string): Promise<SimpleResult> {
  await requireUser("/account/orders");
  if (!checkId(orderId)) return { ok: false, message: "Order not found." };
  const parsed = messageBodySchema.safeParse(body);
  if (!parsed.success)
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Write a message first." };

  const supabase = await createClient();
  const { error } = await supabase.from("order_messages").insert({ order_id: orderId, body: parsed.data });
  if (error)
    return {
      ok: false,
      message: userFacingDbError(error, "We could not send the message. Please try again."),
    };
  refreshOrder(orderId);
  return { ok: true };
}

export async function markMessagesRead(orderId: string): Promise<void> {
  await requireUser("/account/orders");
  if (!checkId(orderId)) return;
  const supabase = await createClient();
  const { data } = await supabase.rpc("mark_order_messages_read", { _order_id: orderId });
  // The queue and order pages show unread markers, so refresh them when something changed.
  if (typeof data === "number" && data > 0) refreshOrder(orderId);
}
