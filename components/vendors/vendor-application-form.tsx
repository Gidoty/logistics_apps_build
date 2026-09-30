"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { Field, FormMessage } from "@/components/forms/form-parts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { fieldErrorsFromIssues } from "@/lib/catalog/schemas";
import type { FormState } from "@/lib/form-state";
import {
  buildVendorDocumentPath,
  VENDOR_DOCUMENT_BUCKET,
  validateVendorDocumentFile,
  type VendorDocumentMimeType,
} from "@/lib/storage/vendor-documents";
import { createClient } from "@/lib/supabase/client";
import { submitVendorApplication } from "@/lib/vendors/actions";
import { createVendorApplicationSchema } from "@/lib/vendors/schemas";

type Props = {
  userId: string;
  countries: { code: string; name: string }[];
  categoryGroups: { name: string; categories: { slug: string; name: string }[] }[];
  defaults: {
    businessName: string;
    countryCode: string;
    city: string;
    phone: string;
    businessRegNumber: string;
    categories: string[];
  };
  /** Set when an earlier application was rejected: the old document can be kept. */
  existingDocumentPath: string | null;
  resubmitting: boolean;
};

export function VendorApplicationForm({
  userId,
  countries,
  categoryGroups,
  defaults,
  existingDocumentPath,
  resubmitting,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [message, setMessage] = useState<FormState>({ status: "idle" });
  const [progress, setProgress] = useState<string | null>(null);

  const categorySlugs = categoryGroups.flatMap((group) => group.categories.map((category) => category.slug));

  function fail(text: string, fieldErrors: Record<string, string[]> = {}) {
    setProgress(null);
    setErrors(fieldErrors);
    setMessage({ status: "error", message: text });
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage({ status: "idle" });
    setErrors({});

    const data = new FormData(event.currentTarget);
    const picked = data.get("document");
    const file = picked instanceof File && picked.size > 0 ? picked : null;

    let documentPath = existingDocumentPath ?? "";
    if (file) {
      const problem = validateVendorDocumentFile(file);
      if (problem) return fail("Please fix the highlighted fields.", { document: [problem] });
      documentPath = buildVendorDocumentPath(userId, file.type as VendorDocumentMimeType);
    }

    const input = {
      businessName: String(data.get("businessName") ?? ""),
      countryCode: String(data.get("countryCode") ?? ""),
      city: String(data.get("city") ?? ""),
      phone: String(data.get("phone") ?? ""),
      businessRegNumber: String(data.get("businessRegNumber") ?? ""),
      categories: data.getAll("categories").map(String),
      documentPath,
    };

    // The same checks the server runs, so mistakes are caught before anything is uploaded.
    const parsed = createVendorApplicationSchema({
      countries: countries.map((country) => country.code),
      categories: categorySlugs,
      userId,
    }).safeParse(input);
    if (!parsed.success) {
      const fieldErrors = fieldErrorsFromIssues(parsed.error.issues);
      if (fieldErrors.documentPath) fieldErrors.document = fieldErrors.documentPath;
      return fail("Please fix the highlighted fields.", fieldErrors);
    }

    startTransition(async () => {
      if (file) {
        setProgress("Uploading your document...");
        const { error } = await createClient()
          .storage.from(VENDOR_DOCUMENT_BUCKET)
          .upload(documentPath, file, { contentType: file.type, upsert: false });
        if (error) return fail("We could not upload your document. Check your connection and try again.");
      }

      setProgress("Sending your application...");
      const result = await submitVendorApplication(input);
      if (!result.ok) {
        // Do not leave the uploaded file behind.
        if (file) await createClient().storage.from(VENDOR_DOCUMENT_BUCKET).remove([documentPath]);
        const fieldErrors = { ...(result.fieldErrors ?? {}) };
        if (fieldErrors.documentPath) fieldErrors.document = fieldErrors.documentPath;
        return fail(result.message, fieldErrors);
      }

      router.push("/account?applied=1");
      router.refresh();
    });
  }

  const busy = pending;

  return (
    <form onSubmit={onSubmit} className="grid gap-4" noValidate>
      <FormMessage state={message} />

      <Field id="businessName" label="Business name" errors={errors.businessName}>
        {(describedBy, invalid) => (
          <Input
            id="businessName"
            name="businessName"
            required
            maxLength={120}
            autoComplete="organization"
            defaultValue={defaults.businessName}
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
            defaultValue={defaults.countryCode}
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
            defaultValue={defaults.city}
            aria-describedby={describedBy}
            aria-invalid={invalid}
          />
        )}
      </Field>

      <Field
        id="phone"
        label="Business phone"
        errors={errors.phone}
        hint="International format, for example +2348031234567 or +8613800000000."
      >
        {(describedBy, invalid) => (
          <Input
            id="phone"
            name="phone"
            type="tel"
            inputMode="tel"
            required
            autoComplete="tel"
            defaultValue={defaults.phone}
            aria-describedby={describedBy}
            aria-invalid={invalid}
          />
        )}
      </Field>

      <Field
        id="businessRegNumber"
        label="Business registration number (optional)"
        errors={errors.businessRegNumber}
        hint="For example your CAC number in Nigeria or your business licence number in China."
      >
        {(describedBy, invalid) => (
          <Input
            id="businessRegNumber"
            name="businessRegNumber"
            maxLength={50}
            defaultValue={defaults.businessRegNumber}
            aria-describedby={describedBy}
            aria-invalid={invalid}
          />
        )}
      </Field>

      <fieldset className="grid gap-3" aria-describedby={errors.categories ? "categories-error" : undefined}>
        <legend className="text-sm font-medium">What do you sell?</legend>
        {categoryGroups.map((group) => (
          <div key={group.name} className="grid gap-2">
            <p className="text-muted-foreground text-xs font-medium">{group.name}</p>
            <div className="grid grid-cols-2 gap-2">
              {group.categories.map((category) => (
                <label key={category.slug} className="flex min-h-10 items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    name="categories"
                    value={category.slug}
                    defaultChecked={defaults.categories.includes(category.slug)}
                    className="accent-primary size-4"
                  />
                  {category.name}
                </label>
              ))}
            </div>
          </div>
        ))}
        {errors.categories ? (
          <p id="categories-error" className="text-destructive text-xs">
            {errors.categories.join(" ")}
          </p>
        ) : null}
      </fieldset>

      <Field
        id="document"
        label={existingDocumentPath ? "New ID document (optional)" : "ID document"}
        errors={errors.document}
        hint={
          existingDocumentPath
            ? "Your earlier document is kept unless you upload a new one. JPG, PNG, WebP or PDF, up to 5 MB."
            : "A government ID or business licence. JPG, PNG, WebP or PDF, up to 5 MB. Only our review team can see it."
        }
      >
        {(describedBy, invalid) => (
          <Input
            id="document"
            name="document"
            type="file"
            accept="image/jpeg,image/png,image/webp,application/pdf"
            aria-describedby={describedBy}
            aria-invalid={invalid}
            className="h-auto py-2"
          />
        )}
      </Field>

      <div className="grid gap-2">
        <Button type="submit" disabled={busy} aria-busy={busy}>
          {busy
            ? (progress ?? "Please wait...")
            : resubmitting
              ? "Send application again"
              : "Send application"}
        </Button>
      </div>
    </form>
  );
}
