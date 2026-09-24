"use client";

import { useActionState } from "react";
import { Field, FormMessage, HiddenNext, SubmitButton } from "@/components/forms/form-parts";
import { Input } from "@/components/ui/input";
import { sendMagicLink, signInWithPassword } from "@/lib/auth/actions";
import { initialFormState } from "@/lib/form-state";

export function PasswordSignInForm({ next }: { next?: string }) {
  const [state, action] = useActionState(signInWithPassword, initialFormState);
  return (
    <form action={action} className="grid gap-4" noValidate>
      <HiddenNext next={next} />
      <FormMessage state={state} />
      <Field id="email" label="Email" errors={state.fieldErrors?.email}>
        {(describedBy, invalid) => (
          <Input id="email" name="email" type="email" autoComplete="email" inputMode="email" required
            aria-describedby={describedBy} aria-invalid={invalid} />
        )}
      </Field>
      <Field id="password" label="Password" errors={state.fieldErrors?.password}>
        {(describedBy, invalid) => (
          <Input id="password" name="password" type="password" autoComplete="current-password" required
            aria-describedby={describedBy} aria-invalid={invalid} />
        )}
      </Field>
      <SubmitButton pendingLabel="Signing in...">Sign in</SubmitButton>
    </form>
  );
}

export function MagicLinkForm({ next }: { next?: string }) {
  const [state, action] = useActionState(sendMagicLink, initialFormState);
  return (
    <form action={action} className="grid gap-4" noValidate>
      <HiddenNext next={next} />
      <FormMessage state={state} />
      <Field id="magic-email" label="Email" errors={state.fieldErrors?.email}
        hint="We will email you a link that signs you in. No password needed.">
        {(describedBy, invalid) => (
          <Input id="magic-email" name="email" type="email" autoComplete="email" inputMode="email" required
            aria-describedby={describedBy} aria-invalid={invalid} />
        )}
      </Field>
      <SubmitButton variant="outline" pendingLabel="Sending...">Email me a sign-in link</SubmitButton>
    </form>
  );
}
