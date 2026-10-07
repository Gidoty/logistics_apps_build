"use client";

import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { createDutyRate, replaceDutyRate } from "@/lib/pricing/admin-actions";
import { fieldError, useAdminAction } from "./use-admin-action";

type Percents = { importDutyPercent: string; vatPercent: string; otherLeviesPercent: string; notes: string };

type Props =
  | {
      mode: "create";
      corridors: { id: string; name: string }[];
      categories: { slug: string; name: string }[];
    }
  | { mode: "change"; ruleId: string; initial: Percents };

/** Adds a duty rate, or changes one (the old rate is closed, never edited). */
export function DutyRateForm(props: Props) {
  const { pending, result, run } = useAdminAction();
  const [values, setValues] = useState<Percents>(
    props.mode === "change"
      ? props.initial
      : { importDutyPercent: "", vatPercent: "", otherLeviesPercent: "", notes: "" },
  );
  const [corridorId, setCorridorId] = useState("");
  const [categorySlug, setCategorySlug] = useState("");
  const set = (key: keyof Percents, value: string) => setValues((current) => ({ ...current, [key]: value }));
  const id = props.mode === "change" ? props.ruleId : "new-duty";

  const percent = (name: keyof Percents, label: string) => (
    <div className="grid gap-1">
      <Label htmlFor={`${id}-${name}`} className="text-xs">
        {label}
      </Label>
      <Input
        id={`${id}-${name}`}
        value={values[name]}
        inputMode="decimal"
        autoComplete="off"
        onChange={(e) => set(name, e.target.value)}
        aria-invalid={Boolean(fieldError(result, name))}
      />
      {fieldError(result, name) ? (
        <p className="text-destructive text-xs">{fieldError(result, name)}</p>
      ) : null}
    </div>
  );

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        run(() =>
          props.mode === "change"
            ? replaceDutyRate({ ruleId: props.ruleId, ...values })
            : createDutyRate({ corridorId, categorySlug, ...values }),
        );
      }}
      className="grid gap-3"
      noValidate
    >
      {result ? <Alert variant={result.ok ? "success" : "destructive"}>{result.message}</Alert> : null}
      {props.mode === "create" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1">
            <Label htmlFor="new-duty-corridor" className="text-xs">
              Route
            </Label>
            <NativeSelect
              id="new-duty-corridor"
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
            <Label htmlFor="new-duty-category" className="text-xs">
              Category (empty = all)
            </Label>
            <NativeSelect
              id="new-duty-category"
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
          </div>
        </div>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-3">
        {percent("importDutyPercent", "Import duty %")}
        {percent("otherLeviesPercent", "Other levies %")}
        {percent("vatPercent", "VAT %")}
      </div>
      <div className="grid gap-1">
        <Label htmlFor={`${id}-notes`} className="text-xs">
          Note (optional)
        </Label>
        <Input
          id={`${id}-notes`}
          value={values.notes}
          maxLength={500}
          onChange={(e) => set("notes", e.target.value)}
        />
      </div>
      <div>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving..." : props.mode === "change" ? "Save as a new rate" : "Add duty rate"}
        </Button>
      </div>
    </form>
  );
}
