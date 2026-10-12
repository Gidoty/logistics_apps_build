"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { cancelUnpaidOrder, payForOrder } from "@/lib/payments/actions";

type Props = {
  orderId: string;
  /** "₦137,724.93" */
  chargeText: string;
  /** True when the quote was in another currency, so the bank converts the charge. */
  otherCurrency: boolean;
  expired: boolean;
};

/** Pay with Paystack, or cancel. The amount shown is worked out on the server; the button only asks for the payment page. */
export function PaymentCard({ orderId, chargeText, otherCurrency, expired }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  function pay() {
    setMessage(null);
    startTransition(async () => {
      const result = await payForOrder(orderId);
      // On success the server redirects to Paystack and this never runs.
      if (result && !result.ok) setMessage(result.message);
    });
  }

  function cancel() {
    if (!window.confirm("Cancel this order? Nothing has been charged.")) return;
    setMessage(null);
    startTransition(async () => {
      const result = await cancelUnpaidOrder(orderId);
      if (!result.ok) return setMessage(result.message);
      router.refresh();
    });
  }

  return (
    <div className="grid gap-3">
      {message ? <Alert variant="destructive">{message}</Alert> : null}
      {expired ? (
        <Alert variant="destructive">
          This quote has expired, so the price is no longer held. Cancel this order and ask for a new quote,
          or order again.
        </Alert>
      ) : (
        <>
          <p className="text-base font-semibold">You will be charged {chargeText}.</p>
          {otherCurrency ? (
            <p className="text-muted-foreground text-sm">Your bank converts this to your currency.</p>
          ) : null}
        </>
      )}
      <div className="flex flex-wrap gap-2">
        {!expired ? (
          <Button type="button" size="lg" disabled={pending} aria-busy={pending} onClick={pay}>
            {pending ? "Opening payment..." : "Pay with Paystack"}
          </Button>
        ) : null}
        <Button type="button" variant="outline" disabled={pending} onClick={cancel}>
          Cancel order
        </Button>
      </div>
      <p className="text-muted-foreground text-xs">
        Your payment is held by us and the seller is paid only after your recipient confirms delivery.
      </p>
    </div>
  );
}
