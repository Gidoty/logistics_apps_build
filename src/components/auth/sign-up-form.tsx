"use client";

import { useActionState } from "react";
import { Field, FormMessage, SubmitButton } from "@/components/forms/form-parts";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { signUp } from "@/lib/auth/actions";
import { initialFormState } from "@/lib/form-state";

type CountryOption = { code: string; name: string };

export function SignUpForm({ countries }: { countries: CountryOption[] }) {
  const [state, action] = useActionState(signUp, initialFormState);
  const errors = state.fieldErrors ?? {};

  return (
    <form action={action} className="grid gap-4" noValidate>
      <FormMessage state={state} />
      <Field id="fullName" label="Full name" errors={errors.fullName}>
        {(describedBy, invalid) => (
          <Input id="fullName" name="fullName" autoComplete="name" required maxLength={120}
            aria-describedby={describedBy} aria-invalid={invalid} />
        )}
      </Field>
      <Field id="email" label="Email" errors={errors.email}>
        {(describedBy, invalid) => (
          <Input id="email" name="email" type="email" autoComplete="email" inputMode="email" required
            aria-describedby={describedBy} aria-invalid={invalid} />
        )}
      </Field>
      <Field id="countryCode" label="Country you live in" errors={errors.countryCode}
        hint="Used to show prices in your currency. You can change it later.">
        {(describedBy, invalid) => (
          <NativeSelect id="countryCode" name="countryCode" required defaultValue=""
            aria-describedby={describedBy} aria-invalid={invalid}>
            <option value="" disabled>Choose a country</option>
            {countries.map((country) => (
              <option key={country.code} value={country.code}>{country.name}</option>
            ))}
          </NativeSelect>
        )}
      </Field>
      <Field id="password" label="Password" errors={errors.password}
        hint="At least 8 characters, with a letter and a number.">
        {(describedBy, invalid) => (
          <Input id="password" name="password" type="password" autoComplete="new-password" required
            minLength={8} maxLength={72} aria-describedby={describedBy} aria-invalid={invalid} />
        )}
      </Field>
      <SubmitButton pendingLabel="Creating account...">Create account</SubmitButton>
    </form>
  );
}
