import type { Metadata } from "next";
import Link from "next/link";
import { MarkPurchasedForm } from "@/components/fulfilment/mark-purchased-form";
import { ProofUploadForm } from "@/components/fulfilment/proof-upload-form";
import { OrderStatusBadge } from "@/components/orders/order-status-badge";
import { Alert } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireApprovedVendor } from "@/lib/auth/session";
import { listVendorOrders } from "@/lib/fulfilment/vendor-orders";
import { formatDateTime } from "@/lib/orders/format";

export const metadata: Metadata = { title: "Vendor: orders" };

export default async function VendorOrdersPage() {
  await requireApprovedVendor("/vendor/orders");
  const orders = await listVendorOrders();

  return (
    <div className="mx-auto grid max-w-3xl gap-5 px-4 py-8">
      <div className="grid gap-1">
        <Link href="/vendor" className="text-primary text-sm underline">
          Vendor
        </Link>
        <h1 className="text-2xl font-bold">Orders</h1>
        <p className="text-muted-foreground text-sm">
          Paid orders for your products. Mark an order as purchased when you have it ready, then upload the
          proof photos. You see only the city the order goes to.
        </p>
      </div>

      {orders.length === 0 ? <p className="text-muted-foreground text-sm">No paid orders yet.</p> : null}

      {orders.map((order) => (
        <Card key={order.order_id}>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2">
              <span className="break-words">
                {order.quantity} x {order.item ?? "Item"}
              </span>
              <OrderStatusBadge status={order.status} />
            </CardTitle>
            <CardDescription>
              Ordered {formatDateTime(order.created_at)} · delivers to {order.recipient_city ?? "Nigeria"}
              {order.supplier_reference ? ` · your reference ${order.supplier_reference}` : ""}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {order.needs_review ? (
              <Alert>Our team is checking this order. You will be able to continue once they finish.</Alert>
            ) : null}
            {order.status === "paid" && !order.needs_review ? (
              <MarkPurchasedForm orderId={order.order_id} id={`ref-${order.order_id}`} />
            ) : null}
            {order.status === "purchased" && !order.needs_review ? (
              <ProofUploadForm orderId={order.order_id} />
            ) : null}
            {order.status === "inspection_pending" ? (
              <p className="text-sm">Proof sent. Waiting for the buyer to approve it (up to 48 hours).</p>
            ) : null}
            {order.status === "disputed" ? (
              <p className="text-sm">The buyer raised a dispute. Our team will contact you.</p>
            ) : null}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
