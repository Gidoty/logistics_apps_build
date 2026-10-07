import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LinkPreviewCard } from "@/components/orders/link-preview-card";
import { MessageThread } from "@/components/orders/message-thread";
import { OrderStatusBadge } from "@/components/orders/order-status-badge";
import { OrderTimeline } from "@/components/orders/order-timeline";
import { QuoteActions } from "@/components/orders/quote-actions";
import { QuoteBreakdown } from "@/components/orders/quote-breakdown";
import { QuoteCountdown } from "@/components/orders/quote-countdown";
import { Alert } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/auth/session";
import { isUuid } from "@/lib/catalog/shop-queries";
import { formatMoney } from "@/lib/money";
import { formatDateTime } from "@/lib/orders/format";
import { getOwnOrder } from "@/lib/orders/queries";
import { DECLINE_REASON_LABELS, type DeclineReason } from "@/lib/orders/schemas";
import { buildRequestTimeline } from "@/lib/orders/timeline";
import { listActiveCurrencies } from "@/lib/reference/queries";

export const metadata: Metadata = { title: "Order" };

export default async function OrderPage({ params, searchParams }: PageProps<"/account/orders/[orderId]">) {
  const { orderId } = await params;
  await requireUser(`/account/orders/${orderId}`);
  if (!isUuid(orderId)) notFound();

  const [detail, currencies, query] = await Promise.all([
    getOwnOrder(orderId),
    listActiveCurrencies(),
    searchParams,
  ]);
  if (!detail) notFound();
  const { order, preview, recipient, quote, messages } = detail;
  const quoteCurrency = quote ? currencies.find((currency) => currency.code === quote.currency) : undefined;
  const budgetCurrency = currencies.find((currency) => currency.code === order.buyer_currency);

  const waiting = order.status === "quoted" && quote?.status === "sent";
  const declineReason = order.decline_reason
    ? (DECLINE_REASON_LABELS[order.decline_reason as DeclineReason] ?? order.decline_reason)
    : null;

  return (
    <div className="mx-auto grid max-w-2xl gap-5 px-4 py-8">
      <div className="grid gap-1">
        <Link href="/account/orders" className="text-primary text-sm underline">
          Your orders
        </Link>
        <h1 className="flex flex-wrap items-center gap-2 text-2xl font-bold">
          Order <OrderStatusBadge status={order.status} />
        </h1>
        <p className="text-muted-foreground text-sm">Requested {formatDateTime(order.created_at)}</p>
      </div>

      {query.new === "1" ? (
        <Alert variant="success">
          Request sent. We will email you when your quote is ready, usually within a day.
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Progress</CardTitle>
        </CardHeader>
        <CardContent>
          <OrderTimeline steps={buildRequestTimeline(order.status)} />
        </CardContent>
      </Card>

      {order.status === "cancelled" && declineReason ? (
        <Alert variant="destructive">
          <p className="font-medium">We could not take this order: {declineReason}.</p>
          {order.decline_note ? <p className="mt-1 break-words">{order.decline_note}</p> : null}
        </Alert>
      ) : null}

      {quote && quoteCurrency ? (
        <Card>
          <CardHeader>
            <CardTitle>Your quote</CardTitle>
            <CardDescription>
              {quote.status === "sent" ? (
                <>
                  <QuoteCountdown expiresAt={quote.expires_at} /> · valid until{" "}
                  {formatDateTime(quote.expires_at)}
                </>
              ) : quote.status === "accepted" ? (
                `Accepted ${quote.accepted_at ? formatDateTime(quote.accepted_at) : ""}`
              ) : quote.status === "expired" ? (
                `Expired ${formatDateTime(quote.expires_at)}`
              ) : (
                "You declined this quote."
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <QuoteBreakdown lines={quote.lines} totalMinor={quote.total_minor} currency={quoteCurrency} />
            {waiting ? (
              <QuoteActions
                orderId={order.id}
                mode="respond"
                totalText={formatMoney(quote.total_minor, quoteCurrency, { withCode: true })}
              />
            ) : null}
            {order.status === "awaiting_payment" ? (
              <Alert variant="success">
                You accepted this quote. Payment will open here soon, and we will email you when it is ready.
              </Alert>
            ) : null}
            {order.status === "quote_expired" ? (
              <>
                <Alert variant="destructive">
                  This quote has expired. Prices and exchange rates change, so we need to confirm them again.
                </Alert>
                <QuoteActions orderId={order.id} mode="requote" />
              </>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>What you asked for</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm">
          <LinkPreviewCard preview={preview} host={order.source_host} />
          {order.source_url ? (
            <a
              href={order.source_url}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="text-primary break-all underline"
            >
              Open the product page
            </a>
          ) : null}
          <p>Quantity: {order.quantity}</p>
          {order.variant_notes ? <p className="break-words">Details: {order.variant_notes}</p> : null}
          {order.buyer_notes ? <p className="break-words">Notes: {order.buyer_notes}</p> : null}
          {order.max_budget_minor !== null && budgetCurrency ? (
            <p>Your budget: {formatMoney(order.max_budget_minor, budgetCurrency, { withCode: true })}</p>
          ) : null}
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
          <CardDescription>Questions about this order go here. We reply by email too.</CardDescription>
        </CardHeader>
        <CardContent>
          <MessageThread orderId={order.id} messages={messages} viewerIsAdmin={false} />
        </CardContent>
      </Card>
    </div>
  );
}
