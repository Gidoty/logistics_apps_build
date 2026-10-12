"use client";

import { ActionForm } from "@/components/admin-orders/action-form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { clearOrderFlags } from "@/lib/orders/admin-order-actions";

export function ClearFlagsForm({ orderId }: { orderId: string }) {
  return (
    <ActionForm
      submitLabel="Mark as handled"
      onSubmit={(data) => clearOrderFlags(orderId, String(data.get("note") ?? ""))}
    >
      <div className="grid gap-1">
        <Label htmlFor="flag-note" className="text-xs">
          What did you do? (kept in the audit log)
        </Label>
        <Input id="flag-note" name="note" maxLength={500} />
      </div>
    </ActionForm>
  );
}
