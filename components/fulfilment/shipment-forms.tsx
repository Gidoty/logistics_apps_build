"use client";

import { ActionForm } from "@/components/admin-orders/action-form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { addShipmentEvent, attachOrderToShipment, createShipment } from "@/lib/fulfilment/actions";

export type ShippableOrder = { id: string; label: string };

export function CreateShipmentForm({ orders }: { orders: ShippableOrder[] }) {
  return (
    <ActionForm
      submitLabel="Create shipment"
      onSubmit={(data) =>
        createShipment({
          partner: String(data.get("partner") ?? ""),
          trackingNumber: String(data.get("tracking") ?? ""),
          origin: String(data.get("origin") ?? ""),
          destination: String(data.get("destination") ?? ""),
          orderIds: data.getAll("orders").map(String),
        })
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1">
          <Label htmlFor="ship-partner" className="text-xs">
            Partner (for example DHL, GIG)
          </Label>
          <Input id="ship-partner" name="partner" maxLength={80} required />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="ship-tracking" className="text-xs">
            Tracking number
          </Label>
          <Input id="ship-tracking" name="tracking" maxLength={100} autoComplete="off" />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="ship-origin" className="text-xs">
            From (country code)
          </Label>
          <Input id="ship-origin" name="origin" maxLength={2} defaultValue="CN" required />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="ship-destination" className="text-xs">
            To (country code)
          </Label>
          <Input id="ship-destination" name="destination" maxLength={2} defaultValue="NG" required />
        </div>
      </div>
      <fieldset className="grid gap-1">
        <legend className="text-xs font-medium">Orders ready to ship</legend>
        {orders.length === 0 ? (
          <p className="text-muted-foreground text-sm">No inspected orders are waiting.</p>
        ) : (
          orders.map((order) => (
            <label key={order.id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="orders" value={order.id} className="size-4" />
              <span className="break-words">{order.label}</span>
            </label>
          ))
        )}
      </fieldset>
    </ActionForm>
  );
}

export function AttachOrderForm({ shipmentId, orders }: { shipmentId: string; orders: ShippableOrder[] }) {
  if (orders.length === 0) return null;
  return (
    <ActionForm
      submitLabel="Add order"
      onSubmit={(data) => attachOrderToShipment(shipmentId, String(data.get("order") ?? ""))}
    >
      <NativeSelect name="order" aria-label="Order to add" defaultValue={orders[0].id}>
        {orders.map((order) => (
          <option key={order.id} value={order.id}>
            {order.label}
          </option>
        ))}
      </NativeSelect>
    </ActionForm>
  );
}

const STEPS = [
  ["shipped", "Shipped"],
  ["in_transit", "In transit"],
  ["arrived_destination", "Arrived in Nigeria"],
  ["customs_cleared", "Customs cleared"],
  ["out_for_delivery", "Out for delivery"],
] as const;

export function ShipmentEventForm({
  shipmentId,
  currentStatus,
}: {
  shipmentId: string;
  currentStatus: string;
}) {
  const next = STEPS.slice(STEPS.findIndex(([value]) => value === currentStatus) + 1);
  if (next.length === 0)
    return <p className="text-muted-foreground text-sm">This shipment is out for delivery.</p>;
  return (
    <ActionForm
      submitLabel="Add event"
      onSubmit={(data) =>
        addShipmentEvent({
          shipmentId,
          status: String(data.get("status") ?? ""),
          note: String(data.get("note") ?? ""),
          location: String(data.get("location") ?? ""),
        })
      }
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="grid gap-1">
          <Label htmlFor={`ev-status-${shipmentId}`} className="text-xs">
            Step
          </Label>
          <NativeSelect id={`ev-status-${shipmentId}`} name="status" defaultValue={next[0][0]}>
            {next.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="grid gap-1">
          <Label htmlFor={`ev-loc-${shipmentId}`} className="text-xs">
            Location (optional)
          </Label>
          <Input id={`ev-loc-${shipmentId}`} name="location" maxLength={120} />
        </div>
        <div className="grid gap-1">
          <Label htmlFor={`ev-note-${shipmentId}`} className="text-xs">
            Note (optional)
          </Label>
          <Input id={`ev-note-${shipmentId}`} name="note" maxLength={500} />
        </div>
      </div>
    </ActionForm>
  );
}
