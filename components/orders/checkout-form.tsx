"use client";

import { FormMessage, Field } from "@/components/forms/form-parts";
import { useServerForm } from "@/components/forms/use-server-form";
import { RecipientFields } from "@/components/recipients/recipient-fields";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { useState } from "react";
import { createCatalogCheckout } from "@/lib/orders/checkout";

type Props = {
  productId: string;
  maxQuantity: number;
  recipients: { id: string; full_name: string; city: string; state: string }[];
  states: string[];
  currencies: { code: string; name: string; symbol: string }[];
  defaultCurrency: string;
};

export function CheckoutForm({
  productId,
  maxQuantity,
  recipients,
  states,
  currencies,
  defaultCurrency,
}: Props) {
  const { state, pending, onSubmit } = useServerForm(createCatalogCheckout);
  const errors = state.fieldErrors ?? {};
  const [recipientId, setRecipientId] = useState(recipients[0]?.id ?? "new");

  return (
    <form onSubmit={onSubmit} className="grid gap-5" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="productId" value={productId} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="quantity" label="Quantity" errors={errors.quantity}>
          {(describedBy, invalid) => (
            <Input
              id="quantity"
              name="quantity"
              type="number"
              inputMode="numeric"
              min={1}
              max={maxQuantity}
              step={1}
              defaultValue="1"
              required
              aria-describedby={describedBy}
              aria-invalid={invalid}
            />
          )}
        </Field>
        <Field id="buyerCurrency" label="Show the price in" errors={errors.buyerCurrency}>
          {(describedBy, invalid) => (
            <NativeSelect
              id="buyerCurrency"
              name="buyerCurrency"
              defaultValue={defaultCurrency}
              required
              aria-describedby={describedBy}
              aria-invalid={invalid}
            >
              {currencies.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code} ({c.symbol}), {c.name}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>
      </div>

      <section className="grid gap-3">
        <h2 className="text-lg font-semibold">Who receives it in Nigeria</h2>
        <Field id="recipientId" label="Recipient" errors={errors.recipientId}>
          {(describedBy, invalid) => (
            <NativeSelect
              id="recipientId"
              name="recipientId"
              value={recipientId}
              onChange={(e) => setRecipientId(e.target.value)}
              required
              aria-describedby={describedBy}
              aria-invalid={invalid}
            >
              {recipients.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.full_name}, {r.city}, {r.state}
                </option>
              ))}
              <option value="new">Add a new recipient</option>
            </NativeSelect>
          )}
        </Field>
        {recipientId === "new" ? (
          <div className="rounded-lg border p-4">
            <RecipientFields states={states} prefix="recipient_" errors={errors} />
          </div>
        ) : null}
      </section>

      <Alert>
        Next you see the full price, with shipping, customs and delivery in one total. Nothing is charged
        until you pay. The price is held for 30 minutes.
      </Alert>
      <div>
        <Button type="submit" size="lg" disabled={pending} aria-busy={pending}>
          {pending ? "Working out the price..." : "See the total"}
        </Button>
      </div>
    </form>
  );
}
