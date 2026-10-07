"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { acceptQuote, declineQuote, requestNewQuote } from "@/lib/orders/actions";

type Props = { orderId: string; mode: "respond" | "requote"; totalText?: string };

/** Accept or decline a waiting quote, or ask for a new one after it expired. */
export function QuoteActions({ orderId, mode, totalText }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  function run(action: () => Promise<{ ok: boolean; message?: string }>) {
    setMessage(null);
    startTransition(async () => {
      const result = await action();
      // The page reloads its data either way, so the new state (or the expired quote) shows up.
      if (result.message) setMessage({ ok: result.ok, text: result.message });
      router.refresh();
    });
  }

  if (mode === "requote") {
    return (
      <div className="grid gap-2">
        {message ? <Alert variant={message.ok ? "success" : "destructive"}>{message.text}</Alert> : null}
        <Button type="button" disabled={pending} onClick={() => run(() => requestNewQuote(orderId))}>
          Ask for a new quote
        </Button>
      </div>
    );
  }

  return (
    <div className="grid gap-2">
      {message ? <Alert variant={message.ok ? "success" : "destructive"}>{message.text}</Alert> : null}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          disabled={pending}
          onClick={() => {
            const question = totalText
              ? `Accept this quote for ${totalText}? You will pay in the next step.`
              : "Accept this quote?";
            if (window.confirm(question)) run(() => acceptQuote(orderId));
          }}
        >
          Accept quote
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={() => {
            if (window.confirm("Decline this quote? The request will be closed."))
              run(() => declineQuote(orderId));
          }}
        >
          Decline
        </Button>
      </div>
    </div>
  );
}
