"use client";

import { ActionForm } from "@/components/admin-orders/action-form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { adminMarkDelivered, unlockDeliveryCode } from "@/lib/delivery/actions";

export function UnlockCodeForm({ orderId }: { orderId: string }) {
  return (
    <ActionForm
      submitLabel="Unlock the code"
      variant="outline"
      onSubmit={() => unlockDeliveryCode(orderId)}
    />
  );
}

export function MarkDeliveredForm({ orderId }: { orderId: string }) {
  return (
    <ActionForm
      submitLabel="Mark as delivered"
      variant="outline"
      confirmText="Mark this order as delivered without the delivery code?"
      onSubmit={(data) => adminMarkDelivered(orderId, String(data.get("note") ?? ""))}
    >
      <div className="grid gap-1">
        <Label htmlFor="delivered-note" className="text-xs">
          How was delivery confirmed? (required, kept in the history)
        </Label>
        <Input id="delivered-note" name="note" maxLength={1000} required />
      </div>
    </ActionForm>
  );
}
