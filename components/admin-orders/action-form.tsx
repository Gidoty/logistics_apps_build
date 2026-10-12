"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

type Result = { ok: boolean; message: string };

/**
 * A small form around an admin action. `onSubmit` returns the result; the page
 * data is reloaded when it worked. Used for the one-field and two-field actions.
 */
export function ActionForm({
  submitLabel,
  pendingLabel,
  children,
  onSubmit,
  variant = "default",
  confirmText,
}: {
  submitLabel: string;
  pendingLabel?: string;
  children?: ReactNode;
  onSubmit: (data: FormData) => Promise<Result>;
  variant?: "default" | "outline" | "destructive";
  confirmText?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<Result | null>(null);

  return (
    <form
      className="grid gap-3"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (confirmText && !window.confirm(confirmText)) return;
        const form = event.currentTarget;
        const data = new FormData(form);
        setResult(null);
        startTransition(async () => {
          const outcome = await onSubmit(data);
          setResult(outcome);
          if (outcome.ok) {
            form.reset();
            router.refresh();
          }
        });
      }}
    >
      {result ? (
        <Alert variant={result.ok ? "success" : "destructive"} aria-live="polite">
          {result.message}
        </Alert>
      ) : null}
      {children}
      <div>
        <Button type="submit" size="sm" variant={variant} disabled={pending} aria-busy={pending}>
          {pending ? (pendingLabel ?? "Working...") : submitLabel}
        </Button>
      </div>
    </form>
  );
}
