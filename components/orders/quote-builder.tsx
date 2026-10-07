"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { formatMoney, parseMoneyInput, type CurrencyFormat } from "@/lib/money";
import { calculateQuote, sendQuote } from "@/lib/orders/admin-actions";
import { computeMargin } from "@/lib/orders/margin";
import { EXPIRY_OPTIONS, isOverBudget } from "@/lib/orders/quote-lines";
import type { CalcView } from "@/lib/pricing/view";

export type BuilderInputs = {
  itemPrice: string;
  itemCurrency: string;
  categorySlug: string;
  weightGrams: string;
  length: string;
  width: string;
  height: string;
  specialHandling: boolean;
  corridorId: string;
};

type Row = {
  calcType: string | null;
  label: string;
  amount: string;
  reason: string;
  /** The calculated amount in minor units. Null for a line added by hand. */
  original: number | null;
  estimated: boolean;
};

type Props = {
  orderId: string;
  buyerCurrency: CurrencyFormat;
  quantity: number;
  destinationState: string;
  maxBudgetMinor: number | null;
  needsCorridor: boolean;
  corridors: { id: string; name: string }[];
  currencies: { code: string; name: string }[];
  categoryGroups: { name: string; categories: { slug: string; name: string }[] }[];
  isRevision: boolean;
  initial: BuilderInputs;
  initialNotes: string;
};

type Failure = { message: string; fieldErrors?: Record<string, string[]> };

export function QuoteBuilder(props: Props) {
  const router = useRouter();
  const [calculating, startCalculate] = useTransition();
  const [sending, startSend] = useTransition();
  const [inputs, setInputs] = useState<BuilderInputs>(props.initial);
  const [calc, setCalc] = useState<{ view: CalcView; signature: string } | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [expiry, setExpiry] = useState("48");
  const [notes, setNotes] = useState(props.initialNotes);
  const [confirmOver, setConfirmOver] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  const digits = props.buyerCurrency.minor_unit_digits;
  const errors = failure?.fieldErrors ?? {};
  const set = <K extends keyof BuilderInputs>(key: K, value: BuilderInputs[K]) =>
    setInputs((current) => ({ ...current, [key]: value }));

  const signature = JSON.stringify(inputs);
  const outOfDate = calc !== null && calc.signature !== signature;

  function parsed(row: Row): number | null {
    const result = parseMoneyInput(row.amount, digits, { allowZero: true });
    return result.ok ? result.minor : null;
  }
  const changed = (row: Row) => row.original !== null && parsed(row) !== row.original;

  const amounts = rows.map(parsed);
  const total = amounts.every((amount) => amount !== null)
    ? (amounts as number[]).reduce((sum, amount) => sum + amount, 0)
    : null;
  const over = total !== null && isOverBudget(total, props.maxBudgetMinor);
  const margin =
    total === null
      ? null
      : computeMargin(
          rows.map((row, index) => ({
            type: row.calcType ?? "other",
            amountMinor: amounts[index] as number,
            override:
              row.calcType === null
                ? { originalAmountMinor: null }
                : changed(row)
                  ? { originalAmountMinor: row.original }
                  : null,
          })),
        );

  function calculate() {
    setFailure(null);
    setSent(null);
    startCalculate(async () => {
      const result = await calculateQuote({ orderId: props.orderId, ...inputs });
      if (!result.ok) {
        setCalc(null);
        setRows([]);
        return setFailure({ message: result.message, fieldErrors: result.fieldErrors });
      }
      setCalc({ view: result.view, signature });
      setRows(
        result.view.lines.map((line) => ({
          calcType: line.calcType,
          label: line.label,
          amount: line.amount,
          reason: "",
          original: line.amountMinor,
          estimated: line.estimated,
        })),
      );
      setConfirmOver(false);
    });
  }

  function send(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!calc) return;
    setFailure(null);
    startSend(async () => {
      const result = await sendQuote({
        orderId: props.orderId,
        snapshot: calc.view.snapshot,
        lines: rows.map((row) => ({
          calcType: row.calcType,
          label: row.label,
          amount: row.amount,
          reason: row.reason,
        })),
        expiresInHours: expiry,
        internalNotes: notes,
        confirmOverBudget: confirmOver,
      });
      if (!result.ok) return setFailure({ message: result.message, fieldErrors: result.fieldErrors });
      setSent(result.message);
      setCalc(null);
      setRows([]);
      router.refresh();
    });
  }

  const updateRow = (index: number, patch: Partial<Row>) =>
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  const fmt = (minor: number) => formatMoney(minor, props.buyerCurrency, { withCode: true });

  return (
    <form onSubmit={send} className="grid gap-6" noValidate>
      {sent ? <Alert variant="success">{sent}</Alert> : null}
      {failure ? (
        <Alert variant="destructive" aria-live="polite">
          <p>{failure.message}</p>
          {errors.lines ? (
            <ul className="mt-1 list-disc pl-5">
              {errors.lines.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          ) : null}
        </Alert>
      ) : null}

      <fieldset className="grid gap-4">
        <legend className="mb-1 text-sm font-medium">
          Item and parcel ({props.quantity} {props.quantity === 1 ? "item" : "items"}, delivered to{" "}
          {props.destinationState})
        </legend>

        {props.needsCorridor ? (
          <div className="grid gap-2">
            <Label htmlFor="corridorId">Shipping route for this store</Label>
            <NativeSelect
              id="corridorId"
              value={inputs.corridorId}
              onChange={(e) => set("corridorId", e.target.value)}
            >
              <option value="">Choose a route</option>
              {props.corridors.map((corridor) => (
                <option key={corridor.id} value={corridor.id}>
                  {corridor.name}
                </option>
              ))}
            </NativeSelect>
            {errors.corridorId ? (
              <p className="text-destructive text-xs">{errors.corridorId.join(" ")}</p>
            ) : null}
          </div>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="itemPrice">Price of one item</Label>
            <Input
              id="itemPrice"
              value={inputs.itemPrice}
              inputMode="decimal"
              autoComplete="off"
              onChange={(e) => set("itemPrice", e.target.value)}
              aria-invalid={Boolean(errors.itemPrice)}
            />
            {errors.itemPrice ? (
              <p className="text-destructive text-xs">{errors.itemPrice.join(" ")}</p>
            ) : null}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="itemCurrency">Item currency</Label>
            <NativeSelect
              id="itemCurrency"
              value={inputs.itemCurrency}
              onChange={(e) => set("itemCurrency", e.target.value)}
            >
              <option value="">Choose a currency</option>
              {props.currencies.map((currency) => (
                <option key={currency.code} value={currency.code}>
                  {currency.code}, {currency.name}
                </option>
              ))}
            </NativeSelect>
            {errors.itemCurrency ? (
              <p className="text-destructive text-xs">{errors.itemCurrency.join(" ")}</p>
            ) : null}
          </div>
        </div>

        <div className="grid gap-2">
          <Label htmlFor="categorySlug">Category</Label>
          <NativeSelect
            id="categorySlug"
            value={inputs.categorySlug}
            onChange={(e) => set("categorySlug", e.target.value)}
          >
            <option value="">Choose a category</option>
            {props.categoryGroups.map((group) => (
              <optgroup key={group.name} label={group.name}>
                {group.categories.map((category) => (
                  <option key={category.slug} value={category.slug}>
                    {category.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </NativeSelect>
          {errors.categorySlug ? (
            <p className="text-destructive text-xs">{errors.categorySlug.join(" ")}</p>
          ) : null}
        </div>

        <div className="grid gap-4 sm:grid-cols-4">
          <div className="grid gap-2 sm:col-span-1">
            <Label htmlFor="weightGrams">Weight (grams)</Label>
            <Input
              id="weightGrams"
              value={inputs.weightGrams}
              inputMode="numeric"
              autoComplete="off"
              onChange={(e) => set("weightGrams", e.target.value)}
            />
            {errors.weightGrams ? (
              <p className="text-destructive text-xs">{errors.weightGrams.join(" ")}</p>
            ) : null}
          </div>
          {(["length", "width", "height"] as const).map((key) => (
            <div key={key} className="grid gap-2">
              <Label htmlFor={key}>{key[0].toUpperCase() + key.slice(1)} (cm)</Label>
              <Input
                id={key}
                value={inputs[key]}
                inputMode="decimal"
                autoComplete="off"
                onChange={(e) => set(key, e.target.value)}
              />
            </div>
          ))}
        </div>
        {errors.length || errors.width || errors.height ? (
          <p className="text-destructive text-xs">
            {[...(errors.length ?? []), ...(errors.width ?? []), ...(errors.height ?? [])].join(" ")}
          </p>
        ) : null}

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4"
            checked={inputs.specialHandling}
            onChange={(e) => set("specialHandling", e.target.checked)}
          />
          Needs special handling (batteries, fragile, large)
        </label>

        <div>
          <Button type="button" onClick={calculate} disabled={calculating} aria-busy={calculating}>
            {calculating ? "Calculating..." : calc ? "Calculate again" : "Calculate"}
          </Button>
        </div>
      </fieldset>

      {calc ? (
        <section className="grid gap-4" aria-label="Calculated quote">
          {outOfDate ? (
            <Alert variant="destructive">
              You changed the item or parcel details. Calculate again before sending.
            </Alert>
          ) : null}
          {calc.view.warnings.map((warning) => (
            <Alert key={warning.code}>{warning.message}</Alert>
          ))}
          <p className="text-muted-foreground text-xs">
            Chargeable weight {calc.view.chargeableWeightGrams} g (
            {calc.view.weightBasis === "volumetric" ? "box size" : "actual weight"}). Amounts are in{" "}
            {props.buyerCurrency.code}. Change an amount only if you must; you will be asked why.
          </p>

          <div className="grid gap-3">
            {rows.map((row, index) => {
              const isChanged = changed(row);
              const manual = row.calcType === null;
              return (
                <div key={index} className="grid gap-2 rounded-lg border p-3">
                  <div className="grid gap-2 sm:grid-cols-[1fr_9rem_auto] sm:items-end">
                    <div className="grid gap-1">
                      <Label htmlFor={`label-${index}`} className="text-xs">
                        {manual ? "Label (the buyer sees this)" : "Line"}
                      </Label>
                      {manual ? (
                        <Input
                          id={`label-${index}`}
                          value={row.label}
                          maxLength={200}
                          onChange={(e) => updateRow(index, { label: e.target.value })}
                        />
                      ) : (
                        <p id={`label-${index}`} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                          {row.label}
                          {row.estimated ? <Badge variant="outline">Estimated</Badge> : null}
                          {isChanged ? (
                            <Badge className="border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300">
                              Overridden (admin only)
                            </Badge>
                          ) : null}
                        </p>
                      )}
                    </div>
                    <div className="grid gap-1">
                      <Label htmlFor={`amount-${index}`} className="text-xs">
                        Amount
                      </Label>
                      <Input
                        id={`amount-${index}`}
                        value={row.amount}
                        inputMode="decimal"
                        autoComplete="off"
                        onChange={(e) => updateRow(index, { amount: e.target.value })}
                      />
                    </div>
                    {manual ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setRows((current) => current.filter((_, i) => i !== index))}
                      >
                        Remove
                      </Button>
                    ) : isChanged ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          const original = calc.view.lines.find((line) => line.calcType === row.calcType);
                          if (original) updateRow(index, { amount: original.amount, reason: "" });
                        }}
                      >
                        Reset
                      </Button>
                    ) : (
                      <span />
                    )}
                  </div>
                  {isChanged && row.original !== null ? (
                    <p className="text-muted-foreground text-xs">Calculated: {fmt(row.original)}</p>
                  ) : null}
                  {isChanged || manual ? (
                    <div className="grid gap-1">
                      <Label htmlFor={`reason-${index}`} className="text-xs">
                        {manual ? "Why add this line? (admin only)" : "Why change it? (admin only)"}
                      </Label>
                      <Input
                        id={`reason-${index}`}
                        value={row.reason}
                        maxLength={500}
                        onChange={(e) => updateRow(index, { reason: e.target.value })}
                      />
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
          <div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                setRows((current) => [
                  ...current,
                  { calcType: null, label: "", amount: "0", reason: "", original: null, estimated: false },
                ])
              }
            >
              Add a manual line
            </Button>
          </div>

          <p className="text-base font-semibold">
            Total:{" "}
            {total === null ? (
              <span className="text-muted-foreground text-sm font-normal">
                enter every amount to see the total
              </span>
            ) : (
              fmt(total)
            )}
          </p>
          {calc.view.customsDisclaimer ? (
            <p className="text-muted-foreground text-xs">{calc.view.customsDisclaimer}</p>
          ) : null}

          {margin ? (
            <div className="bg-muted grid gap-1 rounded-lg px-3 py-2 text-xs" aria-label="Margin, admin only">
              <p className="font-medium">
                Platform revenue on this quote (admin only): {fmt(margin.revenueMinor)}
              </p>
              <p>
                Service fee {fmt(margin.serviceFeeMinor)}, conversion fee {fmt(margin.fxSpreadMinor)}, changes
                and manual lines {fmt(margin.overrideUpliftMinor)}
              </p>
            </div>
          ) : null}

          {over && props.maxBudgetMinor !== null ? (
            <Alert variant="destructive">
              <p>This is above the buyer&apos;s budget of {fmt(props.maxBudgetMinor)}.</p>
              <label className="mt-2 flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={confirmOver}
                  onChange={(e) => setConfirmOver(e.target.checked)}
                  className="mt-0.5 size-4"
                />
                <span>Send it anyway</span>
              </label>
              {errors.confirmOverBudget ? (
                <p className="mt-1 text-xs">{errors.confirmOverBudget.join(" ")}</p>
              ) : null}
            </Alert>
          ) : null}

          <div className="grid gap-2 sm:max-w-xs">
            <Label htmlFor="expiry">Quote valid for</Label>
            <NativeSelect id="expiry" value={expiry} onChange={(e) => setExpiry(e.target.value)}>
              {EXPIRY_OPTIONS.map((hours) => (
                <option key={hours} value={hours}>
                  {hours} hours
                </option>
              ))}
            </NativeSelect>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="internalNotes">Internal notes (the buyer never sees these)</Label>
            <Textarea
              id="internalNotes"
              value={notes}
              maxLength={2000}
              rows={3}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          <div>
            <Button type="submit" disabled={sending || outOfDate || total === null} aria-busy={sending}>
              {sending ? "Sending..." : props.isRevision ? "Send revised quote" : "Send quote"}
            </Button>
          </div>
        </section>
      ) : null}
    </form>
  );
}
