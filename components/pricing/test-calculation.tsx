"use client";

import { useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { testCalculation, type TestCalculationResult } from "@/lib/pricing/admin-actions";
import { CalcResult } from "./calc-result";

type Props = {
  currencies: { code: string; symbol: string; minor_unit_digits: number }[];
  corridors: { id: string; name: string }[];
  categoryGroups: { name: string; categories: { slug: string; name: string }[] }[];
  states: string[];
};

const INITIAL = {
  itemPrice: "",
  itemCurrency: "CNY",
  quantity: "1",
  weightGrams: "",
  length: "",
  width: "",
  height: "",
  categorySlug: "",
  corridorId: "",
  destinationState: "Lagos",
  buyerCurrency: "NGN",
  specialHandling: false,
};

/** Runs the engine on the live rules and rates. Nothing is saved and no quote is created. */
export function TestCalculation({ currencies, corridors, categoryGroups, states }: Props) {
  const [values, setValues] = useState(INITIAL);
  const [result, setResult] = useState<TestCalculationResult | null>(null);
  const [pending, startTransition] = useTransition();
  const set = <K extends keyof typeof INITIAL>(key: K, value: (typeof INITIAL)[K]) =>
    setValues((current) => ({ ...current, [key]: value }));
  const errors = result && !result.ok ? (result.fieldErrors ?? {}) : {};
  const shown = result?.ok ? currencies.find((c) => c.code === result.view.currency) : undefined;

  const input = (key: keyof typeof INITIAL, label: string, inputMode?: "decimal" | "numeric") => (
    <div className="grid gap-1">
      <Label htmlFor={`test-${key}`} className="text-xs">
        {label}
      </Label>
      <Input
        id={`test-${key}`}
        value={String(values[key])}
        inputMode={inputMode}
        autoComplete="off"
        onChange={(e) => set(key, e.target.value as never)}
        aria-invalid={Boolean(errors[key])}
      />
      {errors[key] ? <p className="text-destructive text-xs">{errors[key].join(" ")}</p> : null}
    </div>
  );
  const select = (
    key: "itemCurrency" | "buyerCurrency" | "destinationState" | "corridorId" | "categorySlug",
    label: string,
    children: React.ReactNode,
  ) => (
    <div className="grid gap-1">
      <Label htmlFor={`test-${key}`} className="text-xs">
        {label}
      </Label>
      <NativeSelect id={`test-${key}`} value={values[key]} onChange={(e) => set(key, e.target.value)}>
        {children}
      </NativeSelect>
      {errors[key] ? <p className="text-destructive text-xs">{errors[key].join(" ")}</p> : null}
    </div>
  );

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        setResult(null);
        startTransition(async () => setResult(await testCalculation(values)));
      }}
      className="grid gap-4"
      noValidate
    >
      <div className="grid gap-3 sm:grid-cols-3">
        {select(
          "corridorId",
          "Route",
          <>
            <option value="">Choose a route</option>
            {corridors.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </>,
        )}
        {select(
          "categorySlug",
          "Category",
          <>
            <option value="">Choose a category</option>
            {categoryGroups.map((g) => (
              <optgroup key={g.name} label={g.name}>
                {g.categories.map((c) => (
                  <option key={c.slug} value={c.slug}>
                    {c.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </>,
        )}
        {select(
          "destinationState",
          "Deliver to",
          states.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          )),
        )}
        {input("itemPrice", "Price of one item", "decimal")}
        {select(
          "itemCurrency",
          "Item currency",
          currencies.map((c) => (
            <option key={c.code} value={c.code}>
              {c.code}
            </option>
          )),
        )}
        {input("quantity", "Quantity", "numeric")}
        {input("weightGrams", "Weight (grams)", "numeric")}
        {input("length", "Length (cm)", "decimal")}
        {input("width", "Width (cm)", "decimal")}
        {input("height", "Height (cm)", "decimal")}
        {select(
          "buyerCurrency",
          "Buyer pays in",
          currencies.map((c) => (
            <option key={c.code} value={c.code}>
              {c.code}
            </option>
          )),
        )}
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="size-4"
          checked={values.specialHandling}
          onChange={(e) => set("specialHandling", e.target.checked)}
        />
        Special handling
      </label>
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Calculating..." : "Test calculation"}
        </Button>
      </div>

      {result && !result.ok ? (
        <Alert variant="destructive" aria-live="polite">
          {result.code ? <p className="font-medium">{result.code}</p> : null}
          <p>{result.message}</p>
        </Alert>
      ) : null}
      {result?.ok && shown ? <CalcResult view={result.view} currency={shown} /> : null}
    </form>
  );
}
