import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ClearFlagsForm } from "@/components/admin-orders/clear-flags-form";
import { OrderStatusBadge } from "@/components/orders/order-status-badge";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireAdmin } from "@/lib/auth/session";
import { isUuid } from "@/lib/catalog/shop-queries";
import { formatMoney } from "@/lib/money";
import { getAdminOrder } from "@/lib/orders/admin-orders";
import { formatDateTime } from "@/lib/orders/format";
import { REVIEW_FLAG_LABELS } from "@/lib/orders/review-flags";
import { NGN_FORMAT } from "@/lib/payments/preview";

export const metadata: Metadata = { title: "Admin: order" };

export default async function AdminOrderPage({ params }: PageProps<"/admin/orders/[orderId]">) {
  const { orderId } = await params;
  await requireAdmin(`/admin/orders/${orderId}`);
  if (!isUuid(orderId)) notFound();
  const order = await getAdminOrder(orderId);
  if (!order) notFound();
  const money = (minor: number) => formatMoney(minor, NGN_FORMAT);
  const summary = order.summary;

  return (
    <div className="mx-auto grid max-w-3xl gap-5 px-4 py-8">
      <div className="grid gap-1">
        <Link href="/admin/orders" className="text-primary text-sm underline">
          Orders
        </Link>
        <h1 className="flex flex-wrap items-center gap-2 text-2xl font-bold">
          Order <OrderStatusBadge status={order.status} />
        </h1>
        <p className="text-muted-foreground text-sm">
          {order.order_type === "link" ? "Buy it for me" : "Shop order"} · created{" "}
          {formatDateTime(order.created_at)}
          {order.quotes.length > 0 ? (
            <>
              {" "}
              ·{" "}
              <Link href={`/admin/quotes/${order.id}`} className="text-primary underline">
                quote page
              </Link>
            </>
          ) : null}
        </p>
      </div>

      {order.review_flags.length > 0 ? (
        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle>Needs your attention</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            <ul className="grid gap-2">
              {order.review_flags.map((flag) => (
                <li key={flag}>
                  <Alert variant="destructive">{REVIEW_FLAG_LABELS[flag] ?? flag}</Alert>
                </li>
              ))}
            </ul>
            <ClearFlagsForm orderId={order.id} />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Order</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-1 text-sm">
          <p>
            Buyer: {order.buyer?.full_name || order.buyer?.email} ({order.buyer?.email})
          </p>
          {order.vendor ? <p>Vendor: {order.vendor.business_name}</p> : null}
          {order.source_url ? (
            <a
              href={order.source_url}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="text-primary break-all underline"
            >
              Product link
            </a>
          ) : null}
          <ul className="mt-1 grid gap-1">
            {order.items.map((item, index) => (
              <li key={index} className="break-words">
                {item.quantity} x {item.description}
              </li>
            ))}
          </ul>
          {order.recipient ? (
            <p className="mt-2">
              Deliver to {order.recipient.full_name}, {order.recipient.phone}, {order.recipient.address_line},{" "}
              {order.recipient.city}, {order.recipient.state}
              {order.recipient.landmark ? ` (${order.recipient.landmark})` : ""}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Payments</CardTitle>
          <CardDescription>Paid through Paystack in naira.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm">
          {order.payments.length === 0 ? <p className="text-muted-foreground">No payment started.</p> : null}
          {[...order.payments]
            .sort((a, b) => b.created_at.localeCompare(a.created_at))
            .map((payment) => (
              <div
                key={payment.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"
              >
                <div className="grid gap-0.5">
                  <span className="font-medium">{money(payment.amount_minor)}</span>
                  <span className="text-muted-foreground text-xs break-all">
                    Reference {payment.provider_reference}
                  </span>
                  {payment.display_currency && payment.display_amount_minor ? (
                    <span className="text-muted-foreground text-xs">
                      Quote total {payment.display_currency} {(payment.display_amount_minor / 100).toFixed(2)}
                    </span>
                  ) : null}
                </div>
                <Badge variant={payment.status === "success" ? "default" : "outline"}>{payment.status}</Badge>
              </div>
            ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Ledger</CardTitle>
          <CardDescription>
            The money we hold for this order. Entries cannot be changed or deleted.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm">
          {summary ? (
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              {(
                [
                  ["Held", summary.held_minor],
                  ["Released", summary.released_minor],
                  ["Refunded", summary.refunded_minor],
                  ["Platform fee", summary.platform_fee_minor],
                  ["Balance", summary.balance_minor],
                ] as const
              ).map(([label, value]) => (
                <div key={label} className="rounded-lg border p-2">
                  <dt className="text-muted-foreground text-xs">{label}</dt>
                  <dd className="font-medium tabular-nums">{money(Number(value))}</dd>
                </div>
              ))}
            </dl>
          ) : null}
          <ul className="grid gap-1">
            {[...order.ledger]
              .sort((a, b) => a.created_at.localeCompare(b.created_at))
              .map((entry) => (
                <li
                  key={entry.id}
                  className="flex flex-wrap justify-between gap-2 border-b py-1 last:border-b-0"
                >
                  <span>
                    {entry.entry_type.replaceAll("_", " ")}
                    {entry.reference ? (
                      <span className="text-muted-foreground"> · {entry.reference}</span>
                    ) : null}
                  </span>
                  <span className="tabular-nums">{money(entry.amount_minor)}</span>
                </li>
              ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
