import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DeclineOrderForm } from "@/components/orders/decline-order-form";
import { LinkPreviewCard } from "@/components/orders/link-preview-card";
import { MessageThread } from "@/components/orders/message-thread";
import { OrderStatusBadge } from "@/components/orders/order-status-badge";
import { QuoteBreakdown } from "@/components/orders/quote-breakdown";
import { QuoteBuilder, type BuilderInputs } from "@/components/orders/quote-builder";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireAdmin } from "@/lib/auth/session";
import { isUuid } from "@/lib/catalog/shop-queries";
import { formatMoney, minorToDecimalString } from "@/lib/money";
import { computeMargin } from "@/lib/orders/margin";
import { loadCalcOptions } from "@/lib/pricing/options";
import { formatAge, formatDateTime } from "@/lib/orders/format";
import { getAdminQuoteDetail } from "@/lib/orders/queries";

export const metadata: Metadata = { title: "Admin: quote" };

export default async function AdminQuotePage({ params }: PageProps<"/admin/quotes/[orderId]">) {
  const { orderId } = await params;
  await requireAdmin(`/admin/quotes/${orderId}`);
  if (!isUuid(orderId)) notFound();

  const detail = await getAdminQuoteDetail(orderId);
  if (!detail) notFound();
  const { order, buyer, preview, store, recipient, quotes, messages, currency } = detail;
  if (order.order_type !== "link") notFound();
  if (!currency) throw new Error("The order's currency is missing.");

  const canQuote = order.status === "quote_requested" || order.status === "quoted";
  const waiting = quotes.find((quote) => quote.status === "sent") ?? null;

  const options = await loadCalcOptions();
  // A revision starts from what was entered for the last quote; the amounts are calculated again.
  const last = quotes.find((quote) => quote.snapshot !== null)?.snapshot ?? null;
  const initial: BuilderInputs = {
    itemPrice: last
      ? minorToDecimalString(
          last.input.itemUnitPriceMinor,
          options.context.currencies[last.input.itemCurrency] ?? 2,
        )
      : "",
    itemCurrency: last?.input.itemCurrency ?? "",
    categorySlug: last?.input.categorySlug ?? "",
    weightGrams: last ? String(last.input.actualWeightGrams) : "",
    length: last?.input.dimensionsCm ? String(last.input.dimensionsCm.length) : "",
    width: last?.input.dimensionsCm ? String(last.input.dimensionsCm.width) : "",
    height: last?.input.dimensionsCm ? String(last.input.dimensionsCm.height) : "",
    specialHandling: last?.input.specialHandling ?? false,
    corridorId: order.corridor_id ?? "",
  };

  return (
    <div className="mx-auto grid max-w-3xl gap-5 px-4 py-8">
      <div className="grid gap-1">
        <Link href="/admin/quotes" className="text-primary text-sm underline">
          Quote requests
        </Link>
        <h1 className="flex flex-wrap items-center gap-2 text-2xl font-bold">
          Quote request <OrderStatusBadge status={order.status} />
        </h1>
        <p className="text-muted-foreground text-sm">
          {buyer?.full_name || buyer?.email || "Buyer"}
          {buyer?.email && buyer.full_name ? ` (${buyer.email})` : ""} · requested{" "}
          {formatAge(order.created_at)}
        </p>
      </div>

      {store === null ? (
        <Alert>
          Unknown store ({order.source_host}). Choose the shipping route yourself when you send the quote.
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>The product</CardTitle>
          <CardDescription>
            {store ? store.display_name : order.source_host} · quantity {order.quantity}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm">
          {order.source_url ? (
            <a
              href={order.source_url}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="text-primary font-medium break-all underline"
            >
              Open the product page in a new tab
            </a>
          ) : null}
          <LinkPreviewCard preview={preview} host={order.source_host} />
          {order.variant_notes ? <p className="break-words">Details: {order.variant_notes}</p> : null}
          {order.buyer_notes ? <p className="break-words">Notes: {order.buyer_notes}</p> : null}
          {order.max_budget_minor !== null ? (
            <p>Budget: {formatMoney(order.max_budget_minor, currency, { withCode: true })}</p>
          ) : (
            <p className="text-muted-foreground">No budget given.</p>
          )}
          <p>Buyer pays in {currency.code}.</p>
        </CardContent>
      </Card>

      {recipient ? (
        <Card>
          <CardHeader>
            <CardTitle>Delivery to</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-1 text-sm">
            <p className="font-medium">{recipient.full_name}</p>
            <p>{recipient.phone}</p>
            <p>
              {recipient.address_line}, {recipient.city}, {recipient.state}
            </p>
            {recipient.landmark ? (
              <p className="text-muted-foreground">Landmark: {recipient.landmark}</p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Messages</CardTitle>
        </CardHeader>
        <CardContent>
          <MessageThread orderId={order.id} messages={messages} viewerIsAdmin />
        </CardContent>
      </Card>

      {canQuote ? (
        <Card>
          <CardHeader>
            <CardTitle>{waiting ? "Revise the quote" : "Prepare the quote"}</CardTitle>
            {waiting ? (
              <CardDescription>
                Sending a revision replaces version {waiting.version}. The buyer only ever sees the latest
                one.
              </CardDescription>
            ) : null}
          </CardHeader>
          <CardContent>
            <QuoteBuilder
              orderId={order.id}
              buyerCurrency={currency}
              quantity={order.quantity}
              destinationState={recipient?.state ?? ""}
              maxBudgetMinor={order.max_budget_minor}
              needsCorridor={order.corridor_id === null}
              corridors={options.corridors.map((corridor) => ({ id: corridor.id, name: corridor.name }))}
              currencies={options.currencies}
              categoryGroups={options.categoryGroups}
              isRevision={waiting !== null}
              initial={initial}
              initialNotes={waiting?.internal_notes ?? ""}
            />
          </CardContent>
        </Card>
      ) : null}

      {order.status === "quote_requested" ? (
        <Card>
          <CardHeader>
            <CardTitle>Cannot quote this?</CardTitle>
          </CardHeader>
          <CardContent>
            <DeclineOrderForm orderId={order.id} />
          </CardContent>
        </Card>
      ) : null}

      {quotes.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Quote history</CardTitle>
            <CardDescription>
              Sent quotes cannot be changed. Only the latest is visible to the buyer.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-5">
            {quotes.map((quote) => (
              <div key={quote.id} className="grid gap-2 border-b pb-5 last:border-b-0 last:pb-0">
                <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  Version {quote.version} <Badge variant="outline">{quote.status.replaceAll("_", " ")}</Badge>
                  <span className="text-muted-foreground font-normal">
                    sent {formatDateTime(quote.created_at)}, valid until {formatDateTime(quote.expires_at)}
                  </span>
                </p>
                <QuoteBreakdown lines={quote.lines} totalMinor={quote.total_minor} currency={currency} />
                {quote.lines.some((line) => line.override) ? (
                  <ul className="bg-muted grid gap-1 rounded-md px-3 py-2 text-xs">
                    {quote.lines
                      .filter((line) => line.override)
                      .map((line) => (
                        <li key={line.id} className="break-words">
                          <Badge variant="outline">Overridden (admin only)</Badge> {line.label}:{" "}
                          {line.override?.original_amount_minor === null
                            ? "added by hand"
                            : `calculated ${formatMoney(line.override?.original_amount_minor ?? 0, currency)}, sent ${formatMoney(line.amount_minor, currency)}`}
                          . Reason: {line.override?.reason}
                        </li>
                      ))}
                  </ul>
                ) : null}
                {quote.snapshot ? (
                  <p className="text-muted-foreground text-xs">
                    Platform revenue (admin only):{" "}
                    {formatMoney(
                      computeMargin(
                        quote.lines.map((line) => ({
                          type: line.line_type,
                          amountMinor: line.amount_minor,
                          override: line.override
                            ? { originalAmountMinor: line.override.original_amount_minor }
                            : null,
                        })),
                      ).revenueMinor,
                      currency,
                      { withCode: true },
                    )}
                  </p>
                ) : null}
                {quote.internal_notes ? (
                  <p className="bg-muted rounded-md px-3 py-2 text-xs break-words whitespace-pre-wrap">
                    Internal: {quote.internal_notes}
                  </p>
                ) : null}
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
