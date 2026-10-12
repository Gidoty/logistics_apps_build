"use client";

import { ActionForm } from "@/components/admin-orders/action-form";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { resolveDispute } from "@/lib/fulfilment/actions";

export function ResolveDisputeForm({ orderId, disputeId }: { orderId: string; disputeId: string }) {
  return (
    <ActionForm
      submitLabel="Resolve dispute"
      onSubmit={(data) =>
        resolveDispute(
          orderId,
          disputeId,
          data.get("outcome") === "seller" ? "seller" : "buyer",
          String(data.get("note") ?? ""),
        )
      }
    >
      <div className="grid gap-1">
        <Label htmlFor={`outcome-${disputeId}`} className="text-xs">
          Decided for
        </Label>
        <NativeSelect id={`outcome-${disputeId}`} name="outcome" defaultValue="buyer">
          <option value="buyer">The buyer (then record a refund)</option>
          <option value="seller">The seller (the order continues)</option>
        </NativeSelect>
      </div>
      <div className="grid gap-1">
        <Label htmlFor={`note-${disputeId}`} className="text-xs">
          Note (kept on the dispute)
        </Label>
        <Textarea id={`note-${disputeId}`} name="note" rows={3} maxLength={5000} required />
      </div>
    </ActionForm>
  );
}
