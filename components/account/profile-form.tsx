"use client";

import { useActionState } from "react";
import { Field, FormMessage, SubmitButton } from "@/components/forms/form-parts";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { initialFormState } from "@/lib/form-state";
import { updateProfile } from "@/lib/profile/actions";

type Props = {
  profile: {
    full_name: string;
    phone: string | null;
    country_code: string | null;
    preferred_currency: string;
  };
  countries: { code: string; name: string }[];
  currencies: { code: string; name: string; symbol: string }[];
};

export function ProfileForm({ profile, countries, currencies }: Props) {
  const [state, action] = useActionState(updateProfile, initialFormState);
  const errors = state.fieldErrors ?? {};

  return (
    <form action={action} className="grid gap-4" noValidate>
      <FormMessage state={state} />
      <Field id="fullName" label="Full name" errors={errors.fullName}>
        {(describedBy, invalid) => (
          <Input
            id="fullName"
            name="fullName"
            autoComplete="name"
            required
            maxLength={120}
            defaultValue={profile.full_name}
            aria-describedby={describedBy}
            aria-invalid={invalid}
          />
        )}
      </Field>
      <Field
        id="phone"
        label="Phone (optional)"
        errors={errors.phone}
        hint="International format, for example +2348031234567 or +447700900123."
      >
        {(describedBy, invalid) => (
          <Input
            id="phone"
            name="phone"
            type="tel"
            autoComplete="tel"
            inputMode="tel"
            defaultValue={profile.phone ?? ""}
            aria-describedby={describedBy}
            aria-invalid={invalid}
          />
        )}
      </Field>
      <Field id="countryCode" label="Country you live in" errors={errors.countryCode}>
        {(describedBy, invalid) => (
          <NativeSelect
            id="countryCode"
            name="countryCode"
            defaultValue={profile.country_code ?? ""}
            aria-describedby={describedBy}
            aria-invalid={invalid}
          >
            <option value="">Not set</option>
            {countries.map((country) => (
              <option key={country.code} value={country.code}>
                {country.name}
              </option>
            ))}
          </NativeSelect>
        )}
      </Field>
      <Field id="preferredCurrency" label="Show prices in" errors={errors.preferredCurrency}>
        {(describedBy, invalid) => (
          <NativeSelect
            id="preferredCurrency"
            name="preferredCurrency"
            defaultValue={profile.preferred_currency}
            aria-describedby={describedBy}
            aria-invalid={invalid}
          >
            {currencies.map((currency) => (
              <option key={currency.code} value={currency.code}>
                {currency.code} ({currency.symbol}) {currency.name}
              </option>
            ))}
          </NativeSelect>
        )}
      </Field>
      <SubmitButton pendingLabel="Saving...">Save profile</SubmitButton>
    </form>
  );
}
