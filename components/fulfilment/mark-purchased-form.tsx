"use client";

import { ActionForm } from "@/components/admin-orders/action-form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { markPurchased } from "@/lib/fulfilment/actions";

export function MarkPurchasedForm({ orderId, id = "supplier-ref" }: { orderId: string; id?: string }) {
  return (
    <ActionForm
      submitLabel="Mark as purchased"
      onSubmit={(data) => markPurchased(orderId, String(data.get("reference") ?? ""))}
    >
      <div className="grid gap-1">
        <Label htmlFor={id} className="text-xs">
          Supplier order number (optional)
        </Label>
        <Input id={id} name="reference" maxLength={200} autoComplete="off" />
      </div>
    </ActionForm>
  );
}
