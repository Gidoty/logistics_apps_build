"use client";

import { useActionState } from "react";
import { Field, FormMessage, SubmitButton } from "@/components/forms/form-parts";
import { Input } from "@/components/ui/input";
import { requestPasswordReset, updatePassword } from "@/lib/auth/actions";
import { initialFormState } from "@/lib/form-state";

export function ForgotPasswordForm() {
  const [state, action] = useActionState(requestPasswordReset, initialFormState);
  return (
    <form action={action} className="grid gap-4" noValidate>
      <FormMessage state={state} />
      <Field id="email" label="Email" errors={state.fieldErrors?.email}>
        {(describedBy, invalid) => (
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            inputMode="email"
            required
            aria-describedby={describedBy}
            aria-invalid={invalid}
          />
        )}
      </Field>
      <SubmitButton pendingLabel="Sending...">Send reset link</SubmitButton>
    </form>
  );
}

export function NewPasswordForm() {
  const [state, action] = useActionState(updatePassword, initialFormState);
  return (
    <form action={action} className="grid gap-4" noValidate>
      <FormMessage state={state} />
      <Field
        id="password"
        label="New password"
        errors={state.fieldErrors?.password}
        hint="At least 8 characters, with a letter and a number."
      >
        {(describedBy, invalid) => (
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            maxLength={72}
            aria-describedby={describedBy}
            aria-invalid={invalid}
          />
        )}
      </Field>
      <Field id="confirmPassword" label="Confirm new password" errors={state.fieldErrors?.confirmPassword}>
        {(describedBy, invalid) => (
          <Input
            id="confirmPassword"
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            required
            aria-describedby={describedBy}
            aria-invalid={invalid}
          />
        )}
      </Field>
      <SubmitButton pendingLabel="Saving...">Update password</SubmitButton>
    </form>
  );
}
