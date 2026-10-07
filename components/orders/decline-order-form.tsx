"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { declineOrder } from "@/lib/orders/admin-actions";
import { DECLINE_REASONS, DECLINE_REASON_LABELS } from "@/lib/orders/schemas";

/** Closes a request that cannot be quoted. The buyer is told why. */
export function DeclineOrderForm({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [result, setResult] = useState<{
    ok: boolean;
    message: string;
    fieldErrors?: Record<string, string[]>;
  } | null>(null);
  const errors = result?.fieldErrors ?? {};

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!window.confirm("Decline this request? The buyer will be told.")) return;
    startTransition(async () => {
      const outcome = await declineOrder({ orderId, reason, note });
      setResult(outcome);
      if (outcome.ok) router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="grid gap-3" noValidate>
      {result ? <Alert variant={result.ok ? "success" : "destructive"}>{result.message}</Alert> : null}
      <div className="grid gap-2">
        <Label htmlFor="declineReason">Reason</Label>
        <NativeSelect id="declineReason" value={reason} onChange={(event) => setReason(event.target.value)}>
          <option value="">Choose a reason</option>
          {DECLINE_REASONS.map((value) => (
            <option key={value} value={value}>
              {DECLINE_REASON_LABELS[value]}
            </option>
          ))}
        </NativeSelect>
        {errors.reason ? <p className="text-destructive text-xs">{errors.reason.join(" ")}</p> : null}
      </div>
      <div className="grid gap-2">
        <Label htmlFor="declineNote">Note for the buyer (required for Other)</Label>
        <Textarea
          id="declineNote"
          value={note}
          maxLength={500}
          rows={2}
          onChange={(event) => setNote(event.target.value)}
        />
        {errors.note ? <p className="text-destructive text-xs">{errors.note.join(" ")}</p> : null}
      </div>
      <div>
        <Button type="submit" variant="destructive" disabled={pending}>
          {pending ? "Declining..." : "Decline request"}
        </Button>
      </div>
    </form>
  );
}
