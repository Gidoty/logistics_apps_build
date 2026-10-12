import type { Metadata } from "next";
import Link from "next/link";
import {
  AttachOrderForm,
  CreateShipmentForm,
  ShipmentEventForm,
} from "@/components/fulfilment/shipment-forms";
import { OrderStatusBadge } from "@/components/orders/order-status-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireAdmin } from "@/lib/auth/session";
import { listShipments, listShippableOrders } from "@/lib/fulfilment/queries";
import { formatDateTime } from "@/lib/orders/format";

export const metadata: Metadata = { title: "Admin: shipments" };

export default async function AdminShipmentsPage() {
  await requireAdmin("/admin/shipments");
  const [shipments, shippable] = await Promise.all([listShipments(), listShippableOrders()]);

  return (
    <div className="mx-auto grid max-w-3xl gap-5 px-4 py-8">
      <div className="grid gap-1">
        <Link href="/admin" className="text-primary text-sm underline">
          Admin
        </Link>
        <h1 className="text-2xl font-bold">Shipments</h1>
        <p className="text-muted-foreground text-sm">
          Update a shipment by hand from your partner&apos;s tracking. Each event moves every attached order
          that can take that step.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>New shipment</CardTitle>
          <CardDescription>Several orders can travel together.</CardDescription>
        </CardHeader>
        <CardContent>
          <CreateShipmentForm orders={shippable} />
        </CardContent>
      </Card>

      {shipments.map((shipment) => (
        <Card key={shipment.id}>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2">
              {shipment.logistics_partner}
              {shipment.tracking_number ? ` · ${shipment.tracking_number}` : ""}
              <Badge variant="outline">{shipment.status.replaceAll("_", " ")}</Badge>
            </CardTitle>
            <CardDescription>
              {shipment.origin_country} to {shipment.destination_country} · created{" "}
              {formatDateTime(shipment.created_at)}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 text-sm">
            <ul className="grid gap-1">
              {shipment.orders.map(({ order }) =>
                order ? (
                  <li key={order.id} className="flex flex-wrap items-center gap-2">
                    <Link href={`/admin/orders/${order.id}`} className="text-primary underline">
                      {order.items[0]?.description ?? "Order"}
                    </Link>
                    <OrderStatusBadge status={order.status} />
                  </li>
                ) : null,
              )}
            </ul>
            <ol className="grid gap-1">
              {[...shipment.events]
                .sort((a, b) => a.occurred_at.localeCompare(b.occurred_at))
                .map((event) => (
                  <li key={event.id} className="text-muted-foreground">
                    {formatDateTime(event.occurred_at)} · {event.status.replaceAll("_", " ")}
                    {event.location ? ` · ${event.location}` : ""}
                    {event.note ? ` · ${event.note}` : ""}
                  </li>
                ))}
            </ol>
            {shipment.status === "pending" ? (
              <AttachOrderForm shipmentId={shipment.id} orders={shippable} />
            ) : null}
            <ShipmentEventForm shipmentId={shipment.id} currentStatus={shipment.status} />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
