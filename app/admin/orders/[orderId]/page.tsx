import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MarkDeliveredForm, UnlockCodeForm } from "@/components/delivery/delivery-admin-panel";
import { RefundForm, ReleaseForm } from "@/components/payouts/payout-forms";
import { ensureDeliveryCode } from "@/lib/delivery/issue";
import { getDeliveryCodeState } from "@/lib/delivery/queries";
import { InspectionProofCard } from "@/components/fulfilment/inspection-proof-card";
import { MarkPurchasedForm } from "@/components/fulfilment/mark-purchased-form";
import { ProofUploadForm } from "@/components/fulfilment/proof-upload-form";
import { ResolveDisputeForm } from "@/components/fulfilment/resolve-dispute-form";
import { ClearFlagsForm } from "@/components/admin-orders/clear-flags-form";
import { OrderStatusBadge } from "@/components/orders/order-status-badge";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireAdmin } from "@/lib/auth/session";
import { isUuid } from "@/lib/catalog/shop-queries";
import { getInspectionProof, listDisputesForOrder } from "@/lib/fulfilment/queries";
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
  if (order.status === "out_for_delivery") await ensureDeliveryCode(order.id);
  const codeState = order.status === "out_for_delivery" ? await getDeliveryCodeState(order.id) : null;
  const [proof, disputes] = await Promise.all([getInspectionProof(orderId), listDisputesForOrder(orderId)]);
  const flagged = order.review_flags.length > 0;
  const balanceMinor = Number(order.summary?.balance_minor ?? 0);
  const openDispute = disputes.some((d) => d.status === "open" || d.status === "under_review");
  const canRefund =
    balanceMinor > 0 &&
    ["paid", "purchased", "inspection_pending", "inspection_approved", "disputed"].includes(order.status);
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

      {order.status === "paid" || order.status === "purchased" || disputes.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Fulfilment</CardTitle>
            <CardDescription>
              {order.order_type === "link"
                ? "You buy this item from the store, then upload the proof."
                : "Catalog orders are normally handled by the vendor. You can act for them."}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            {flagged && (order.status === "paid" || order.status === "purchased") ? (
              <Alert variant="destructive">Clear the flags above before the order moves on.</Alert>
            ) : null}
            {order.status === "paid" && !flagged ? <MarkPurchasedForm orderId={order.id} /> : null}
            {order.status === "purchased" && !flagged ? <ProofUploadForm orderId={order.id} /> : null}
            {disputes.map((dispute) => (
              <div key={dispute.id} className="grid gap-2 rounded-lg border p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">Dispute · {formatDateTime(dispute.created_at)}</span>
                  <Badge variant={dispute.status === "open" ? "default" : "outline"}>
                    {dispute.status.replaceAll("_", " ")}
                  </Badge>
                </div>
                <p className="break-words whitespace-pre-line">{dispute.reason}</p>
                {dispute.resolution_note ? (
                  <p className="text-muted-foreground break-words">Resolution: {dispute.resolution_note}</p>
                ) : null}
                {dispute.status === "open" || dispute.status === "under_review" ? (
                  <ResolveDisputeForm orderId={order.id} disputeId={dispute.id} />
                ) : null}
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {order.status === "out_for_delivery" ? (
        <Card>
          <CardHeader>
            <CardTitle>Delivery</CardTitle>
            <CardDescription>
              The recipient confirms with the 6-digit code the buyer holds.{" "}
              {codeState
                ? `${codeState.attempts} wrong ${codeState.attempts === 1 ? "try" : "tries"} so far.`
                : "No code has been made yet."}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            {codeState?.locked ? (
              <>
                <Alert variant="destructive">The code is locked after 5 wrong tries.</Alert>
                <UnlockCodeForm orderId={order.id} />
              </>
            ) : null}
            <MarkDeliveredForm orderId={order.id} />
          </CardContent>
        </Card>
      ) : null}

      {order.status === "delivered" || canRefund ? (
        <Card>
          <CardHeader>
            <CardTitle>Payout and refund</CardTitle>
            <CardDescription>
              Money moves outside the app, by bank transfer. Record it here after you send it.{" "}
              {money(balanceMinor)} is held.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-5">
            {order.status === "delivered" && balanceMinor > 0 ? (
              <ReleaseForm
                orderId={order.id}
                balanceMinor={balanceMinor}
                amountLabel={
                  order.order_type === "link" ? "Release to supplier (purchase cost)" : "Release to vendor"
                }
              />
            ) : null}
            {order.status === "delivered" && balanceMinor === 0 ? (
              <p className="text-muted-foreground text-sm">
                Everything held for this order has been released.
              </p>
            ) : null}
            {canRefund && openDispute ? (
              <Alert>Resolve the open dispute before recording a refund.</Alert>
            ) : null}
            {canRefund && !openDispute ? <RefundForm orderId={order.id} /> : null}
          </CardContent>
        </Card>
      ) : null}

      {proof ? (
        <InspectionProofCard orderId={order.id} status={order.status} proof={proof} viewer="staff" />
      ) : null}

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
