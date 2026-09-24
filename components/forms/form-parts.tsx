"use client";

import { useFormStatus } from "react-dom";
import type { ReactNode } from "react";
import { Alert } from "@/components/ui/alert";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import type { FormState } from "@/lib/form-state";

export function SubmitButton({ children, pendingLabel, ...props }: ButtonProps & { pendingLabel?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} aria-busy={pending} {...props}>
      {pending ? (pendingLabel ?? "Please wait...") : children}
    </Button>
  );
}

export function FormMessage({ state }: { state: FormState }) {
  if (!state.message) return null;
  return (
    <Alert variant={state.status === "error" ? "destructive" : "success"} aria-live="polite">
      {state.message}
    </Alert>
  );
}

type FieldProps = {
  id: string;
  label: string;
  errors?: string[];
  hint?: string;
  children: (describedBy: string | undefined, invalid: boolean) => ReactNode;
};

/** Label, control, hint and error text wired together for screen readers. */
export function Field({ id, label, errors, hint, children }: FieldProps) {
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const invalid = Boolean(errors?.length);
  const describedBy = [hint ? hintId : null, invalid ? errorId : null].filter(Boolean).join(" ") || undefined;

  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      {children(describedBy, invalid)}
      {hint && !invalid ? (
        <p id={hintId} className="text-muted-foreground text-xs">
          {hint}
        </p>
      ) : null}
      {invalid ? (
        <p id={errorId} className="text-destructive text-xs">
          {errors?.join(" ")}
        </p>
      ) : null}
    </div>
  );
}

export function HiddenNext({ next }: { next?: string }) {
  return next ? <input type="hidden" name="next" value={next} /> : null;
}
