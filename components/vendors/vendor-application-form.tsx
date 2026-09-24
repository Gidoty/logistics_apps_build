"use client";

import { useActionState } from "react";
import { Field, FormMessage, SubmitButton } from "@/components/forms/form-parts";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { initialFormState } from "@/lib/form-state";
import { applyToBecomeVendor } from "@/lib/vendors/actions";

type Props = {
  countries: { code: string; name: string }[];
  defaultCountry: string | null;
};

export function VendorApplicationForm({ countries, defaultCountry }: Props) {
  const [state, action] = useActionState(applyToBecomeVendor, initialFormState);
  const errors = state.fieldErrors ?? {};

  return (
    <form action={action} className="grid gap-4" noValidate>
      <FormMessage state={state} />
      <Field id="businessName" label="Business name" errors={errors.businessName}>
        {(describedBy, invalid) => (
          <Input
            id="businessName"
            name="businessName"
            required
            maxLength={120}
            autoComplete="organization"
            aria-describedby={describedBy}
            aria-invalid={invalid}
          />
        )}
      </Field>
      <Field id="countryCode" label="Country your business operates from" errors={errors.countryCode}>
        {(describedBy, invalid) => (
          <NativeSelect
            id="countryCode"
            name="countryCode"
            required
            defaultValue={defaultCountry ?? ""}
            aria-describedby={describedBy}
            aria-invalid={invalid}
          >
            <option value="" disabled>
              Choose a country
            </option>
            {countries.map((country) => (
              <option key={country.code} value={country.code}>
                {country.name}
              </option>
            ))}
          </NativeSelect>
        )}
      </Field>
      <Field id="city" label="City" errors={errors.city}>
        {(describedBy, invalid) => (
          <Input
            id="city"
            name="city"
            required
            maxLength={80}
            autoComplete="address-level2"
            aria-describedby={describedBy}
            aria-invalid={invalid}
          />
        )}
      </Field>
      <SubmitButton pendingLabel="Sending...">Send application</SubmitButton>
    </form>
  );
}
