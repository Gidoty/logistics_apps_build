"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { Field, FormMessage } from "@/components/forms/form-parts";
import { useServerForm } from "@/components/forms/use-server-form";
import { RecipientFields } from "@/components/recipients/recipient-fields";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { createLinkOrder, previewLink, type PreviewResult } from "@/lib/orders/actions";
import { LinkPreviewCard } from "./link-preview-card";

type Props = {
  recipients: { id: string; full_name: string; city: string; state: string }[];
  states: string[];
  currencies: { code: string; name: string; symbol: string }[];
  defaultCurrency: string;
};

export function LinkOrderForm({ recipients, states, currencies, defaultCurrency }: Props) {
  const { state, pending, onSubmit } = useServerForm(createLinkOrder);
  const errors = state.fieldErrors ?? {};
  const [recipientId, setRecipientId] = useState(recipients[0]?.id ?? "new");
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [checking, startChecking] = useTransition();
  const lastChecked = useRef("");

  // Shown on leaving the field. Display only: the order fetches its own preview after it is created.
  function checkLink(value: string) {
    const trimmed = value.trim();
    if (trimmed === "" || trimmed === lastChecked.current) return;
    lastChecked.current = trimmed;
    setPreview(null);
    startChecking(async () => setPreview(await previewLink(trimmed)));
  }

  const linkErrors = errors.productUrl ?? (preview && !preview.ok ? [preview.message] : undefined);

  return (
    <form onSubmit={onSubmit} className="grid gap-6" noValidate>
      <FormMessage state={state} />

      <section className="grid gap-4">
        <h2 className="text-lg font-semibold">The product</h2>
        <Field
          id="productUrl"
          label="Product link"
          errors={linkErrors}
          hint="Copy the link from the store's app or website and paste it here."
        >
          {(describedBy, invalid) => (
            <Input
              id="productUrl"
              name="productUrl"
              inputMode="url"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              required
              maxLength={4000}
              onBlur={(event) => checkLink(event.target.value)}
              aria-describedby={describedBy}
              aria-invalid={invalid}
            />
          )}
        </Field>
        <div aria-live="polite" className="min-h-0">
          {checking ? <p className="text-muted-foreground text-sm">Checking the link...</p> : null}
          {!checking && preview?.ok ? (
            <div className="grid gap-2 rounded-lg border p-3">
              <LinkPreviewCard preview={preview.preview} host={preview.host} />
              {!preview.known ? (
                <p className="text-muted-foreground text-xs">
                  We do not know this store yet. We can still try to quote it, and may take longer to reply.
                </p>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="quantity" label="Quantity" errors={errors.quantity}>
            {(describedBy, invalid) => (
              <Input
                id="quantity"
                name="quantity"
                type="number"
                inputMode="numeric"
                min={1}
                max={100}
                step={1}
                defaultValue="1"
                required
                aria-describedby={describedBy}
                aria-invalid={invalid}
              />
            )}
          </Field>
          <Field id="variantNotes" label="Size, colour or model (optional)" errors={errors.variantNotes}>
            {(describedBy, invalid) => (
              <Input
                id="variantNotes"
                name="variantNotes"
                maxLength={500}
                autoComplete="off"
                aria-describedby={describedBy}
                aria-invalid={invalid}
              />
            )}
          </Field>
        </div>
        <Field id="buyerNotes" label="Anything else we should know (optional)" errors={errors.buyerNotes}>
          {(describedBy, invalid) => (
            <Textarea
              id="buyerNotes"
              name="buyerNotes"
              maxLength={1000}
              rows={3}
              aria-describedby={describedBy}
              aria-invalid={invalid}
            />
          )}
        </Field>
      </section>

      <section className="grid gap-4">
        <h2 className="text-lg font-semibold">Your price</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="buyerCurrency" label="Pay in" errors={errors.buyerCurrency}>
            {(describedBy, invalid) => (
              <NativeSelect
                id="buyerCurrency"
                name="buyerCurrency"
                defaultValue={defaultCurrency}
                required
                aria-describedby={describedBy}
                aria-invalid={invalid}
              >
                {currencies.map((currency) => (
                  <option key={currency.code} value={currency.code}>
                    {currency.code} ({currency.symbol}), {currency.name}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
          <Field
            id="maxBudget"
            label="Most you want to pay (optional)"
            errors={errors.maxBudget}
            hint="We tell you if the quote is higher. You can still decide."
          >
            {(describedBy, invalid) => (
              <Input
                id="maxBudget"
                name="maxBudget"
                inputMode="decimal"
                autoComplete="off"
                aria-describedby={describedBy}
                aria-invalid={invalid}
              />
            )}
          </Field>
        </div>
      </section>

      <section className="grid gap-4">
        <h2 className="text-lg font-semibold">Who receives it in Nigeria</h2>
        <Field id="recipientId" label="Recipient" errors={errors.recipientId}>
          {(describedBy, invalid) => (
            <NativeSelect
              id="recipientId"
              name="recipientId"
              value={recipientId}
              onChange={(event) => setRecipientId(event.target.value)}
              required
              aria-describedby={describedBy}
              aria-invalid={invalid}
            >
              {recipients.map((recipient) => (
                <option key={recipient.id} value={recipient.id}>
                  {recipient.full_name}, {recipient.city}, {recipient.state}
                </option>
              ))}
              <option value="new">Add a new recipient</option>
            </NativeSelect>
          )}
        </Field>
        {recipientId === "new" ? (
          <div className="grid gap-4 rounded-lg border p-4">
            <RecipientFields states={states} prefix="recipient_" errors={errors} />
            <p className="text-muted-foreground text-xs">
              This recipient is saved to your{" "}
              <Link href="/account/recipients" className="underline">
                address book
              </Link>
              .
            </p>
          </div>
        ) : null}
      </section>

      <Alert>
        We reply with one all-in price, usually within a day. Nothing is charged until you accept the quote.
      </Alert>

      <div>
        <Button type="submit" size="lg" disabled={pending} aria-busy={pending}>
          {pending ? "Sending..." : "Request a quote"}
        </Button>
      </div>
    </form>
  );
}
