"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { confirmDeliveryCode } from "@/lib/tracking/actions";

/** The recipient types the 6-digit code once the item is in their hands. */
export function DeliveryCodeForm({ token }: { token: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  return (
    <form
      className="grid gap-3"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const code = String(new FormData(form).get("code") ?? "");
        setMessage(null);
        startTransition(async () => {
          const result = await confirmDeliveryCode(token, code);
          setMessage({ ok: result.ok, text: result.message });
          if (result.ok || ("locked" in result && result.locked)) router.refresh();
          else form.reset();
        });
      }}
    >
      {message ? (
        <Alert variant={message.ok ? "success" : "destructive"} aria-live="polite">
          {message.text}
        </Alert>
      ) : null}
      <div className="grid gap-1">
        <Label htmlFor="delivery-code">Delivery code (6 digits)</Label>
        <Input
          id="delivery-code"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          maxLength={6}
          className="text-center text-2xl tracking-[0.4em]"
          disabled={pending}
        />
        <p className="text-muted-foreground text-xs">Enter it only when you have your item in your hands.</p>
      </div>
      <div>
        <Button type="submit" disabled={pending} aria-busy={pending}>
          {pending ? "Checking..." : "Confirm delivery"}
        </Button>
      </div>
    </form>
  );
}
