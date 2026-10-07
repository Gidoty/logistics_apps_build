"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { formatMoney, parseMoneyInput, type CurrencyFormat } from "@/lib/money";
import { sendQuote } from "@/lib/orders/admin-actions";
import {
  EXPIRY_OPTIONS,
  MAX_QUOTE_LINES,
  QUOTE_LINE_LABELS,
  QUOTE_LINE_TYPES,
  isOverBudget,
  sumLines,
  type QuoteLineType,
} from "@/lib/orders/quote-lines";

export type BuilderLine = { type: QuoteLineType; label: string; amount: string };

type Props = {
  orderId: string;
  currency: CurrencyFormat;
  maxBudgetMinor: number | null;
  needsCorridor: boolean;
  corridors: { id: string; name: string }[];
  isRevision: boolean;
  initialLines: BuilderLine[];
  initialExpiry: number;
  initialWeight: string;
  initialNotes: string;
};

/** Total shown while typing. The server works the total out again from the lines and ignores this one. */
function previewTotal(lines: BuilderLine[], digits: number): number | null {
  const amounts: { amountMinor: number }[] = [];
  for (const line of lines) {
    const parsed = parseMoneyInput(line.amount, digits, { allowZero: true });
    if (!parsed.ok) return null;
    amounts.push({ amountMinor: parsed.minor });
  }
  return sumLines(amounts);
}

export function QuoteBuilder(props: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [lines, setLines] = useState<BuilderLine[]>(props.initialLines);
  const [expiry, setExpiry] = useState(String(props.initialExpiry));
  const [weight, setWeight] = useState(props.initialWeight);
  const [notes, setNotes] = useState(props.initialNotes);
  const [corridorId, setCorridorId] = useState("");
  const [confirmOver, setConfirmOver] = useState(false);
  const [result, setResult] = useState<{
    ok: boolean;
    message: string;
    fieldErrors?: Record<string, string[]>;
  } | null>(null);

  const digits = props.currency.minor_unit_digits;
  const total = previewTotal(lines, digits);
  const over = total !== null && isOverBudget(total, props.maxBudgetMinor);
  const errors = result?.fieldErrors ?? {};

  function updateLine(index: number, patch: Partial<BuilderLine>) {
    setLines((current) => current.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setResult(null);
    startTransition(async () => {
      const outcome = await sendQuote({
        orderId: props.orderId,
        lines,
        expiresInHours: expiry,
        weightGrams: weight,
        internalNotes: notes,
        corridorId,
        confirmOverBudget: confirmOver,
      });
      setResult(outcome);
      if (outcome.ok) router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="grid gap-5" noValidate>
      {result ? (
        <Alert variant={result.ok ? "success" : "destructive"} aria-live="polite">
          {result.message}
        </Alert>
      ) : null}

      {props.needsCorridor ? (
        <div className="grid gap-2">
          <Label htmlFor="corridorId">Shipping route for this store</Label>
          <NativeSelect
            id="corridorId"
            value={corridorId}
            onChange={(event) => setCorridorId(event.target.value)}
            aria-invalid={Boolean(errors.corridorId)}
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

      <fieldset className="grid gap-3">
        <legend className="mb-1 text-sm font-medium">Quote lines ({props.currency.code})</legend>
        {lines.map((line, index) => (
          <div
            key={index}
            className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[10rem_1fr_8rem_auto] sm:items-end"
          >
            <div className="grid gap-1">
              <Label htmlFor={`type-${index}`} className="text-xs">
                Type
              </Label>
              <NativeSelect
                id={`type-${index}`}
                value={line.type}
                onChange={(event) => updateLine(index, { type: event.target.value as QuoteLineType })}
              >
                {QUOTE_LINE_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {QUOTE_LINE_LABELS[type]}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="grid gap-1">
              <Label htmlFor={`label-${index}`} className="text-xs">
                What the buyer sees
              </Label>
              <Input
                id={`label-${index}`}
                value={line.label}
                maxLength={200}
                onChange={(event) => updateLine(index, { label: event.target.value })}
              />
            </div>
            <div className="grid gap-1">
              <Label htmlFor={`amount-${index}`} className="text-xs">
                Amount
              </Label>
              <Input
                id={`amount-${index}`}
                value={line.amount}
                inputMode="decimal"
                autoComplete="off"
                onChange={(event) => updateLine(index, { amount: event.target.value })}
              />
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={lines.length <= 1}
              onClick={() => setLines((current) => current.filter((_, i) => i !== index))}
              aria-label={`Remove line ${index + 1}`}
            >
              Remove
            </Button>
          </div>
        ))}
        {errors.lines ? <p className="text-destructive text-sm">{errors.lines.join(" ")}</p> : null}
        <div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={lines.length >= MAX_QUOTE_LINES}
            onClick={() => setLines((current) => [...current, { type: "other", label: "", amount: "0" }])}
          >
            Add a line
          </Button>
        </div>
      </fieldset>

      <p className="text-base font-semibold">
        Total:{" "}
        {total === null ? (
          <span className="text-muted-foreground text-sm font-normal">
            enter every amount to see the total
          </span>
        ) : (
          formatMoney(total, props.currency, { withCode: true })
        )}
      </p>

      {over && props.maxBudgetMinor !== null ? (
        <Alert variant="destructive">
          <p>
            This is above the buyer&apos;s budget of{" "}
            {formatMoney(props.maxBudgetMinor, props.currency, { withCode: true })}.
          </p>
          <label className="mt-2 flex items-start gap-2">
            <input
              type="checkbox"
              checked={confirmOver}
              onChange={(event) => setConfirmOver(event.target.checked)}
              className="mt-0.5 size-4"
            />
            <span>Send it anyway</span>
          </label>
          {errors.confirmOverBudget ? (
            <p className="mt-1 text-xs">{errors.confirmOverBudget.join(" ")}</p>
          ) : null}
        </Alert>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="expiry">Quote valid for</Label>
          <NativeSelect id="expiry" value={expiry} onChange={(event) => setExpiry(event.target.value)}>
            {EXPIRY_OPTIONS.map((hours) => (
              <option key={hours} value={hours}>
                {hours} hours
              </option>
            ))}
          </NativeSelect>
          {errors.expiresInHours ? (
            <p className="text-destructive text-xs">{errors.expiresInHours.join(" ")}</p>
          ) : null}
        </div>
        <div className="grid gap-2">
          <Label htmlFor="weight">Estimated weight in grams (optional)</Label>
          <Input
            id="weight"
            value={weight}
            inputMode="numeric"
            autoComplete="off"
            onChange={(event) => setWeight(event.target.value)}
          />
          {errors.weightGrams ? (
            <p className="text-destructive text-xs">{errors.weightGrams.join(" ")}</p>
          ) : null}
        </div>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="internalNotes">Internal notes (the buyer never sees these)</Label>
        <Textarea
          id="internalNotes"
          value={notes}
          maxLength={2000}
          rows={3}
          onChange={(event) => setNotes(event.target.value)}
        />
        {errors.internalNotes ? (
          <p className="text-destructive text-xs">{errors.internalNotes.join(" ")}</p>
        ) : null}
      </div>

      <div>
        <Button type="submit" disabled={pending} aria-busy={pending}>
          {pending ? "Sending..." : props.isRevision ? "Send revised quote" : "Send quote"}
        </Button>
      </div>
    </form>
  );
}
