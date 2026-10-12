"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { decideInspection } from "@/lib/fulfilment/actions";

/** The buyer's two choices after looking at the proof. */
export function InspectionDecision({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [disputing, setDisputing] = useState(false);
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  function decide(decision: "approved" | "disputed") {
    setResult(null);
    startTransition(async () => {
      const outcome = await decideInspection(orderId, decision, reason);
      setResult(outcome);
      if (outcome.ok) router.refresh();
    });
  }

  return (
    <div className="grid gap-3">
      {result ? (
        <Alert variant={result.ok ? "success" : "destructive"} aria-live="polite">
          {result.message}
        </Alert>
      ) : null}
      {disputing ? (
        <div className="grid gap-2">
          <Label htmlFor="dispute-reason">What is wrong?</Label>
          <Textarea
            id="dispute-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={4}
            maxLength={5000}
            placeholder="For example: the serial number does not match the box."
          />
          <div className="flex flex-wrap gap-2">
            <Button variant="destructive" onClick={() => decide("disputed")} disabled={pending}>
              {pending ? "Sending..." : "Send dispute"}
            </Button>
            <Button variant="outline" onClick={() => setDisputing(false)} disabled={pending}>
              Back
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => decide("approved")} disabled={pending}>
            {pending ? "Saving..." : "Approve and ship"}
          </Button>
          <Button variant="outline" onClick={() => setDisputing(true)} disabled={pending}>
            Raise a dispute
          </Button>
        </div>
      )}
    </div>
  );
}
