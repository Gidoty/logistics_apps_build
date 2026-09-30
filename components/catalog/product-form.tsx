"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { Field, FormMessage } from "@/components/forms/form-parts";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { saveProduct } from "@/lib/catalog/actions";
import type { ProductFormValues } from "@/lib/catalog/form-values";
import { describeHold, scanProduct } from "@/lib/catalog/prohibited";
import {
  CONDITION_LABELS,
  createProductSchema,
  fieldErrorsFromIssues,
  MAX_SPECS,
  PRODUCT_CONDITIONS,
  type ProductCondition,
  type ProductFormContext,
} from "@/lib/catalog/schemas";
import { formatTransitDays } from "@/lib/catalog/format";
import type { FormState } from "@/lib/form-state";

export type ProductFormOptionsProps = {
  context: ProductFormContext;
  categoryGroups: { name: string; categories: { slug: string; name: string }[] }[];
  currencies: { code: string; name: string; symbol: string; minor_unit_digits: number }[];
  corridors: {
    id: string;
    name: string;
    default_transit_days_min: number | null;
    default_transit_days_max: number | null;
  }[];
};

type Props = {
  options: ProductFormOptionsProps;
  initial: ProductFormValues;
  /** Set when editing. A new product is created without it. */
  productId?: string;
};

const SPEC_SUGGESTIONS = [
  "RAM",
  "Storage",
  "Screen size",
  "Processor",
  "Battery",
  "Camera",
  "Operating system",
  "Color",
  "Connectivity",
  "Capacity (Wh)",
  "Power output (W)",
];

export function ProductForm({ options, initial, productId }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [message, setMessage] = useState<FormState>({ status: "idle" });
  const [heldNotice, setHeldNotice] = useState<string | null>(null);
  const [liveWarning, setLiveWarning] = useState<string | null>(null);
  const [condition, setCondition] = useState<ProductCondition>(initial.condition);
  const [currencyCode, setCurrencyCode] = useState(initial.currency);
  const [specs, setSpecs] = useState(initial.specs);

  const currency = options.currencies.find((item) => item.code === currencyCode);
  const noRoutes = options.corridors.length === 0;

  function readValues(form: HTMLFormElement): ProductFormValues {
    const data = new FormData(form);
    const text = (name: string) => String(data.get(name) ?? "");
    return {
      title: text("title"),
      description: text("description"),
      brand: text("brand"),
      category: text("category"),
      condition: text("condition") as ProductCondition,
      conditionNotes: text("conditionNotes"),
      price: text("price"),
      currency: text("currency"),
      stock: text("stock"),
      weightGrams: text("weightGrams"),
      corridorId: text("corridorId"),
      warrantyMonths: text("warrantyMonths"),
      requiresSpecialHandling: data.get("requiresSpecialHandling") === "on",
      specs,
    };
  }

  // Early warning while typing. The database applies the same check on save.
  function onChange(event: FormEvent<HTMLFormElement>) {
    const values = readValues(event.currentTarget);
    const terms = scanProduct({
      title: values.title,
      description: values.description,
      brand: values.brand,
      conditionNotes: values.conditionNotes,
      specs: Object.fromEntries(values.specs.map((row) => [row.key, row.value])),
    });
    setLiveWarning(terms.length > 0 ? describeHold(terms) : null);
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage({ status: "idle" });
    setHeldNotice(null);
    setErrors({});

    const values = readValues(event.currentTarget);
    const parsed = createProductSchema(options.context).safeParse(values);
    if (!parsed.success) {
      setErrors(fieldErrorsFromIssues(parsed.error.issues));
      setMessage({ status: "error", message: "Please fix the highlighted fields." });
      return;
    }

    startTransition(async () => {
      const result = await saveProduct(values, productId);
      if (!result.ok) {
        setErrors(result.fieldErrors ?? {});
        setMessage({ status: "error", message: result.message });
        return;
      }
      if (!productId) {
        router.push(`/vendor/products/${result.productId}?created=1${result.held ? "&held=1" : ""}`);
        return;
      }
      setMessage({ status: "success", message: "Saved." });
      setHeldNotice(result.held ? (result.heldReason ?? "This listing is under review.") : null);
      router.refresh();
    });
  }

  function updateSpec(index: number, field: "key" | "value", value: string) {
    setSpecs((rows) => rows.map((row, i) => (i === index ? { ...row, [field]: value } : row)));
  }

  return (
    <form onSubmit={onSubmit} onChange={onChange} className="grid gap-4" noValidate>
      <FormMessage state={message} />
      {heldNotice ? <Alert>This listing is under review and stays hidden for now. {heldNotice}</Alert> : null}
      {liveWarning ? (
        <Alert role="status">Heads up: this listing will be held for review. {liveWarning}</Alert>
      ) : null}
      {noRoutes ? (
        <Alert variant="destructive">
          No shipping routes are set up for your country yet, so products cannot be saved. Please contact
          support.
        </Alert>
      ) : null}

      <Field id="title" label="Title" errors={errors.title}>
        {(describedBy, invalid) => (
          <Input
            id="title"
            name="title"
            required
            maxLength={200}
            defaultValue={initial.title}
            aria-describedby={describedBy}
            aria-invalid={invalid}
          />
        )}
      </Field>

      <Field
        id="description"
        label="Description"
        errors={errors.description}
        hint="What is included, what it can do, anything a buyer should know."
      >
        {(describedBy, invalid) => (
          <Textarea
            id="description"
            name="description"
            required
            maxLength={10000}
            rows={6}
            defaultValue={initial.description}
            aria-describedby={describedBy}
            aria-invalid={invalid}
          />
        )}
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="category" label="Category" errors={errors.category}>
          {(describedBy, invalid) => (
            <NativeSelect
              id="category"
              name="category"
              required
              defaultValue={initial.category}
              aria-describedby={describedBy}
              aria-invalid={invalid}
            >
              <option value="" disabled>
                Choose a category
              </option>
              {options.categoryGroups.map((group) => (
                <optgroup key={group.name} label={group.name}>
                  {group.categories.map((category) => (
                    <option key={category.slug} value={category.slug}>
                      {category.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </NativeSelect>
          )}
        </Field>

        <Field id="brand" label="Brand (optional)" errors={errors.brand}>
          {(describedBy, invalid) => (
            <Input
              id="brand"
              name="brand"
              maxLength={80}
              defaultValue={initial.brand}
              aria-describedby={describedBy}
              aria-invalid={invalid}
            />
          )}
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="condition" label="Condition" errors={errors.condition}>
          {(describedBy, invalid) => (
            <NativeSelect
              id="condition"
              name="condition"
              value={condition}
              onChange={(event) => setCondition(event.target.value as ProductCondition)}
              aria-describedby={describedBy}
              aria-invalid={invalid}
            >
              {PRODUCT_CONDITIONS.map((value) => (
                <option key={value} value={value}>
                  {CONDITION_LABELS[value]}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>

        <Field
          id="warrantyMonths"
          label="Warranty (months)"
          errors={errors.warrantyMonths}
          hint="Use 0 for no warranty."
        >
          {(describedBy, invalid) => (
            <Input
              id="warrantyMonths"
              name="warrantyMonths"
              inputMode="numeric"
              defaultValue={initial.warrantyMonths}
              aria-describedby={describedBy}
              aria-invalid={invalid}
            />
          )}
        </Field>
      </div>

      <Field
        id="conditionNotes"
        label={condition === "new" ? "Condition notes (optional)" : "Condition notes (required)"}
        errors={errors.conditionNotes}
        hint={
          condition === "new"
            ? undefined
            : "Be specific: scratches, battery health, missing parts, what the box contains."
        }
      >
        {(describedBy, invalid) => (
          <Textarea
            id="conditionNotes"
            name="conditionNotes"
            maxLength={1000}
            rows={3}
            defaultValue={initial.conditionNotes}
            aria-describedby={describedBy}
            aria-invalid={invalid}
          />
        )}
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          id="price"
          label={`Price${currency ? ` in ${currency.code}` : ""}`}
          errors={errors.price}
          hint={
            currency
              ? `Type it as you would write it, for example ${currency.minor_unit_digits === 0 ? "1500" : "1299.50"}.`
              : undefined
          }
        >
          {(describedBy, invalid) => (
            <Input
              id="price"
              name="price"
              inputMode="decimal"
              defaultValue={initial.price}
              aria-describedby={describedBy}
              aria-invalid={invalid}
            />
          )}
        </Field>

        <Field id="currency" label="Currency" errors={errors.currency}>
          {(describedBy, invalid) => (
            <NativeSelect
              id="currency"
              name="currency"
              value={currencyCode}
              onChange={(event) => setCurrencyCode(event.target.value)}
              aria-describedby={describedBy}
              aria-invalid={invalid}
            >
              {options.currencies.map((item) => (
                <option key={item.code} value={item.code}>
                  {item.code} ({item.symbol}) {item.name}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="stock" label="Units in stock" errors={errors.stock}>
          {(describedBy, invalid) => (
            <Input
              id="stock"
              name="stock"
              inputMode="numeric"
              defaultValue={initial.stock}
              aria-describedby={describedBy}
              aria-invalid={invalid}
            />
          )}
        </Field>

        <Field
          id="weightGrams"
          label="Weight of one unit, packed (grams)"
          errors={errors.weightGrams}
          hint="Used to work out shipping. 1 kg is 1000 g."
        >
          {(describedBy, invalid) => (
            <Input
              id="weightGrams"
              name="weightGrams"
              inputMode="numeric"
              defaultValue={initial.weightGrams}
              aria-describedby={describedBy}
              aria-invalid={invalid}
            />
          )}
        </Field>
      </div>

      <Field
        id="corridorId"
        label="Shipping route"
        errors={errors.corridorId}
        hint="Where the item ships from and to."
      >
        {(describedBy, invalid) => (
          <NativeSelect
            id="corridorId"
            name="corridorId"
            required
            defaultValue={initial.corridorId}
            aria-describedby={describedBy}
            aria-invalid={invalid}
          >
            <option value="" disabled>
              Choose a route
            </option>
            {options.corridors.map((corridor) => {
              const days = formatTransitDays(
                corridor.default_transit_days_min,
                corridor.default_transit_days_max,
              );
              return (
                <option key={corridor.id} value={corridor.id}>
                  {corridor.name}
                  {days ? ` (${days})` : ""}
                </option>
              );
            })}
          </NativeSelect>
        )}
      </Field>

      <label className="flex items-start gap-3 rounded-lg border p-3 text-sm">
        <input
          type="checkbox"
          name="requiresSpecialHandling"
          defaultChecked={initial.requiresSpecialHandling}
          className="accent-primary mt-0.5 size-4"
        />
        <span>
          <span className="font-medium">Needs special handling for shipping</span>
          <span className="text-muted-foreground mt-0.5 block">
            Tick this for large lithium batteries, such as power stations and inverter batteries. They have
            shipping restrictions.
          </span>
        </span>
      </label>

      <fieldset className="grid gap-2">
        <legend className="text-sm font-medium">Specifications (optional)</legend>
        <datalist id="spec-suggestions">
          {SPEC_SUGGESTIONS.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
        {specs.map((row, index) => (
          <div key={index} className="grid grid-cols-[1fr_1fr_auto] items-center gap-2">
            <Input
              aria-label={`Spec ${index + 1} name`}
              list="spec-suggestions"
              placeholder="Name, for example RAM"
              maxLength={40}
              value={row.key}
              onChange={(event) => updateSpec(index, "key", event.target.value)}
            />
            <Input
              aria-label={`Spec ${index + 1} value`}
              placeholder="Value, for example 8 GB"
              maxLength={100}
              value={row.value}
              onChange={(event) => updateSpec(index, "value", event.target.value)}
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={`Remove spec ${index + 1}`}
              onClick={() =>
                setSpecs((rows) =>
                  rows.length === 1 ? [{ key: "", value: "" }] : rows.filter((_, i) => i !== index),
                )
              }
            >
              Remove
            </Button>
          </div>
        ))}
        {errors.specs ? <p className="text-destructive text-xs">{errors.specs.join(" ")}</p> : null}
        <div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={specs.length >= MAX_SPECS}
            onClick={() => setSpecs((rows) => [...rows, { key: "", value: "" }])}
          >
            Add a spec
          </Button>
        </div>
      </fieldset>

      <Button type="submit" disabled={pending || noRoutes} aria-busy={pending}>
        {pending ? "Saving..." : productId ? "Save changes" : "Save and add photos"}
      </Button>
    </form>
  );
}
