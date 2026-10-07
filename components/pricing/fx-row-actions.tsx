"use client";

import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { removeFxOverride, setFxOverride, setFxSpread } from "@/lib/pricing/admin-actions";
import { fieldError, useAdminAction } from "./use-admin-action";

type Props = { quote: string; hasOverride: boolean; spread: string };

/** Set or remove an override for USD to one currency, and set its conversion fee. */
export function FxRowActions({ quote, hasOverride, spread }: Props) {
  const { pending, result, run } = useAdminAction();
  const [rate, setRate] = useState("");
  const [fee, setFee] = useState(spread);

  return (
    <div className="grid gap-3">
      {result ? <Alert variant={result.ok ? "success" : "destructive"}>{result.message}</Alert> : null}
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          run(
            () => setFxOverride({ quote, rate }),
            () => setRate(""),
          );
        }}
      >
        <div className="grid gap-1">
          <Label htmlFor={`rate-${quote}`} className="text-xs">
            1 USD equals ({quote})
          </Label>
          <Input
            id={`rate-${quote}`}
            value={rate}
            inputMode="decimal"
            autoComplete="off"
            onChange={(e) => setRate(e.target.value)}
            className="h-9 w-40"
            aria-invalid={Boolean(fieldError(result, "rate"))}
          />
        </div>
        <Button type="submit" size="sm" variant="outline" disabled={pending}>
          Set override
        </Button>
        {hasOverride ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() => run(() => removeFxOverride(quote))}
          >
            Remove override
          </Button>
        ) : null}
      </form>
      {fieldError(result, "rate") ? (
        <p className="text-destructive text-xs">{fieldError(result, "rate")}</p>
      ) : null}
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          run(() => setFxSpread({ quote, spread: fee }));
        }}
      >
        <div className="grid gap-1">
          <Label htmlFor={`spread-${quote}`} className="text-xs">
            Conversion fee % (shown to buyers)
          </Label>
          <Input
            id={`spread-${quote}`}
            value={fee}
            inputMode="decimal"
            autoComplete="off"
            onChange={(e) => setFee(e.target.value)}
            className="h-9 w-28"
          />
        </div>
        <Button type="submit" size="sm" variant="outline" disabled={pending}>
          Save fee
        </Button>
      </form>
      {fieldError(result, "spread") ? (
        <p className="text-destructive text-xs">{fieldError(result, "spread")}</p>
      ) : null}
    </div>
  );
}
