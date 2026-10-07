"use client";

import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { createFeeRule, replaceFeeRule } from "@/lib/pricing/admin-actions";
import { CALC_METHOD_LABELS, EDITABLE_FEE_TYPES, FEE_TYPE_LABELS } from "@/lib/pricing/admin-schemas";
import { CALC_METHODS } from "@/lib/pricing/types";
import { fieldError, useAdminAction } from "./use-admin-action";

export type FeeRuleFormValues = {
  calcMethod: string;
  value: string;
  currency: string;
  minAmount: string;
  maxAmount: string;
  weightFromG: string;
  weightToG: string;
  notes: string;
};

type Props =
  | {
      mode: "create";
      corridors: { id: string; name: string }[];
      categories: { slug: string; name: string }[];
      zones: { id: string; name: string }[];
      currencies: { code: string }[];
    }
  | {
      mode: "change";
      ruleId: string;
      currencies: { code: string }[];
      initial: FeeRuleFormValues;
    };

const EMPTY: FeeRuleFormValues = {
  calcMethod: "flat",
  value: "",
  currency: "NGN",
  minAmount: "",
  maxAmount: "",
  weightFromG: "",
  weightToG: "",
  notes: "",
};

/** Adds a fee rule, or changes the rate of one (the old rule is closed, never edited). */
export function FeeRuleForm(props: Props) {
  const { pending, result, run } = useAdminAction();
  const [values, setValues] = useState<FeeRuleFormValues>(props.mode === "change" ? props.initial : EMPTY);
  const [corridorId, setCorridorId] = useState("");
  const [feeType, setFeeType] = useState("service_fee");
  const [categorySlug, setCategorySlug] = useState("");
  const [zoneId, setZoneId] = useState("");
  const set = (key: keyof FeeRuleFormValues, value: string) =>
    setValues((current) => ({ ...current, [key]: value }));
  const id = props.mode === "change" ? props.ruleId : "new";

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    run(() =>
      props.mode === "change"
        ? replaceFeeRule({ ruleId: props.ruleId, ...values })
        : createFeeRule({ corridorId, feeType, categorySlug, zoneId, ...values }),
    );
  }

  const text = (name: keyof FeeRuleFormValues, label: string, hint?: string) => (
    <div className="grid gap-1">
      <Label htmlFor={`${id}-${name}`} className="text-xs">
        {label}
      </Label>
      <Input
        id={`${id}-${name}`}
        value={values[name]}
        autoComplete="off"
        onChange={(e) => set(name, e.target.value)}
        aria-invalid={Boolean(fieldError(result, name))}
      />
      {fieldError(result, name) ? (
        <p className="text-destructive text-xs">{fieldError(result, name)}</p>
      ) : hint ? (
        <p className="text-muted-foreground text-xs">{hint}</p>
      ) : null}
    </div>
  );

  const hint =
    values.calcMethod === "percent"
      ? "Percent, for example 5 for 5%"
      : values.calcMethod === "per_kg"
        ? "Amount for each kilogram, for example 9.00"
        : "Amount, for example 2500.00";

  return (
    <form onSubmit={submit} className="grid gap-3" noValidate>
      {result ? <Alert variant={result.ok ? "success" : "destructive"}>{result.message}</Alert> : null}

      {props.mode === "create" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1">
            <Label htmlFor="new-corridor" className="text-xs">
              Route
            </Label>
            <NativeSelect
              id="new-corridor"
              value={corridorId}
              onChange={(e) => setCorridorId(e.target.value)}
            >
              <option value="">Choose a route</option>
              {props.corridors.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </NativeSelect>
            {fieldError(result, "corridorId") ? (
              <p className="text-destructive text-xs">{fieldError(result, "corridorId")}</p>
            ) : null}
          </div>
          <div className="grid gap-1">
            <Label htmlFor="new-feeType" className="text-xs">
              Fee
            </Label>
            <NativeSelect id="new-feeType" value={feeType} onChange={(e) => setFeeType(e.target.value)}>
              {EDITABLE_FEE_TYPES.map((type) => (
                <option key={type} value={type}>
                  {FEE_TYPE_LABELS[type]}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="grid gap-1">
            <Label htmlFor="new-category" className="text-xs">
              Only for category (optional)
            </Label>
            <NativeSelect
              id="new-category"
              value={categorySlug}
              onChange={(e) => setCategorySlug(e.target.value)}
            >
              <option value="">All categories</option>
              {props.categories.map((c) => (
                <option key={c.slug} value={c.slug}>
                  {c.name}
                </option>
              ))}
            </NativeSelect>
            {fieldError(result, "categorySlug") ? (
              <p className="text-destructive text-xs">{fieldError(result, "categorySlug")}</p>
            ) : null}
          </div>
          {feeType === "last_mile" ? (
            <div className="grid gap-1">
              <Label htmlFor="new-zone" className="text-xs">
                Delivery zone
              </Label>
              <NativeSelect id="new-zone" value={zoneId} onChange={(e) => setZoneId(e.target.value)}>
                <option value="">Choose a zone</option>
                {props.zones.map((z) => (
                  <option key={z.id} value={z.id}>
                    {z.name}
                  </option>
                ))}
              </NativeSelect>
              {fieldError(result, "zoneId") ? (
                <p className="text-destructive text-xs">{fieldError(result, "zoneId")}</p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="grid gap-1">
          <Label htmlFor={`${id}-calcMethod`} className="text-xs">
            How it is worked out
          </Label>
          <NativeSelect
            id={`${id}-calcMethod`}
            value={values.calcMethod}
            onChange={(e) => set("calcMethod", e.target.value)}
          >
            {CALC_METHODS.map((m) => (
              <option key={m} value={m}>
                {CALC_METHOD_LABELS[m]}
              </option>
            ))}
          </NativeSelect>
        </div>
        {text("value", "Value", hint)}
        <div className="grid gap-1">
          <Label htmlFor={`${id}-currency`} className="text-xs">
            Currency of the amount
          </Label>
          <NativeSelect
            id={`${id}-currency`}
            value={values.currency}
            onChange={(e) => set("currency", e.target.value)}
          >
            {props.currencies.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code}
              </option>
            ))}
          </NativeSelect>
        </div>
        {text("minAmount", "Minimum (optional)")}
        {text("maxAmount", "Maximum (optional)")}
        <span />
        {text("weightFromG", "Weight from, grams (optional)", "Included. Leave empty for 0.")}
        {text("weightToG", "Weight up to, grams (optional)", "Not included. Empty = no limit.")}
      </div>

      <div className="grid gap-1">
        <Label htmlFor={`${id}-notes`} className="text-xs">
          Note (optional)
        </Label>
        <Textarea
          id={`${id}-notes`}
          value={values.notes}
          rows={2}
          maxLength={500}
          onChange={(e) => set("notes", e.target.value)}
        />
      </div>
      <div>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving..." : props.mode === "change" ? "Save as a new rate" : "Add rule"}
        </Button>
      </div>
    </form>
  );
}
