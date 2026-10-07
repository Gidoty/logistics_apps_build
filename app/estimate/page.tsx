import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { CalcResult } from "@/components/pricing/calc-result";
import { Alert } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { allowEstimate, ESTIMATE_LIMIT } from "@/lib/pricing/estimate-throttle";
import { createCalcRequestSchema, fieldErrorsFromIssues } from "@/lib/pricing/input";
import { loadCalcOptions } from "@/lib/pricing/options";
import { publicPricingMessage } from "@/lib/pricing/public-errors";
import { calculateFromRequest } from "@/lib/pricing/service";
import { toCalcView, type CalcView } from "@/lib/pricing/view";
import { getViewerCurrency } from "@/lib/pricing/viewer-currency-read";

const TITLE = "Delivered price estimator";

export async function generateMetadata({ searchParams }: PageProps<"/estimate">): Promise<Metadata> {
  const submitted = typeof (await searchParams).itemPrice === "string";
  return {
    title: TITLE,
    description:
      "Work out the full cost of buying from China or Nigeria and delivering to any state in Nigeria: freight, customs, delivery and fees, in your currency.",
    // A result page is a personal calculation, not something for search engines to index.
    robots: submitted ? { index: false } : undefined,
  };
}

function first(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : (value?.[0] ?? "");
}

export default async function EstimatePage({ searchParams }: PageProps<"/estimate">) {
  const query = await searchParams;
  const [options, viewer] = await Promise.all([loadCalcOptions(), getViewerCurrency()]);

  const values = {
    itemPrice: first(query.itemPrice),
    itemCurrency:
      first(query.itemCurrency) || (options.currencies.some((c) => c.code === "CNY") ? "CNY" : "USD"),
    quantity: first(query.quantity) || "1",
    weightGrams: first(query.weightGrams),
    length: first(query.length),
    width: first(query.width),
    height: first(query.height),
    categorySlug: first(query.categorySlug),
    corridorId: first(query.corridorId) || options.corridors[0]?.id || "",
    destinationState: first(query.destinationState) || "Lagos",
    buyerCurrency: first(query.buyerCurrency) || viewer.currency.code,
    specialHandling: first(query.specialHandling) === "on",
  };
  const submitted = typeof query.itemPrice === "string";

  let view: CalcView | null = null;
  let failure: string | null = null;
  let errors: Record<string, string[]> = {};
  if (submitted) {
    const parsed = createCalcRequestSchema(options.context).safeParse(values);
    if (!parsed.success) {
      errors = fieldErrorsFromIssues(parsed.error.issues);
    } else if (!(await allowEstimate(await headers()))) {
      failure = `You have used all ${ESTIMATE_LIMIT} estimates for this hour. Please try again later, or ask for an exact quote.`;
    } else {
      try {
        const result = await calculateFromRequest(parsed.data);
        view = toCalcView(result, options.context.currencies[result.currency] ?? 2);
      } catch (error) {
        // Visitors get a plain message. The admin messages name the rules behind it.
        failure = publicPricingMessage(error);
        if (!(error instanceof Error && error.name === "PricingError"))
          console.error("Estimate failed", error);
      }
    }
  }
  const resultCurrency = view ? options.currencies.find((c) => c.code === view.currency) : undefined;

  const field = (
    name: keyof typeof values,
    label: string,
    props: { inputMode?: "decimal" | "numeric"; hint?: string } = {},
  ) => (
    <div className="grid gap-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Input
        id={name}
        name={name}
        defaultValue={String(values[name])}
        inputMode={props.inputMode}
        autoComplete="off"
        aria-invalid={Boolean(errors[name])}
      />
      {errors[name] ? (
        <p className="text-destructive text-xs">{errors[name].join(" ")}</p>
      ) : props.hint ? (
        <p className="text-muted-foreground text-xs">{props.hint}</p>
      ) : null}
    </div>
  );
  const currencyOptions = options.currencies.map((c) => (
    <option key={c.code} value={c.code}>
      {c.code}, {c.name}
    </option>
  ));

  return (
    <div className="mx-auto grid max-w-2xl gap-6 px-4 py-8">
      <div className="grid gap-2">
        <h1 className="text-2xl font-bold tracking-tight">{TITLE}</h1>
        <p className="text-muted-foreground text-sm">
          Buying from China or from a Nigerian store and sending it to Nigeria? Enter the item and where it
          goes. You get every cost as its own line: freight, customs, delivery and fees, in your currency.
          Compare it with what an agent quotes you.
        </p>
      </div>

      <form method="get" action="/estimate" className="grid gap-4" role="search" aria-label="Price estimator">
        <div className="grid gap-4 sm:grid-cols-2">
          {field("itemPrice", "Price of one item", { inputMode: "decimal" })}
          <div className="grid gap-1.5">
            <Label htmlFor="itemCurrency">Currency of that price</Label>
            <NativeSelect id="itemCurrency" name="itemCurrency" defaultValue={values.itemCurrency}>
              {currencyOptions}
            </NativeSelect>
            {errors.itemCurrency ? (
              <p className="text-destructive text-xs">{errors.itemCurrency.join(" ")}</p>
            ) : null}
          </div>
          {field("quantity", "Quantity", { inputMode: "numeric" })}
          {field("weightGrams", "Weight of one item, in grams", {
            inputMode: "numeric",
            hint: "A phone is about 250 g, a laptop about 2000 g.",
          })}
        </div>

        <fieldset className="grid gap-2">
          <legend className="text-sm font-medium">Box size in cm (optional)</legend>
          <div className="grid grid-cols-3 gap-3">
            {field("length", "Length", { inputMode: "decimal" })}
            {field("width", "Width", { inputMode: "decimal" })}
            {field("height", "Height", { inputMode: "decimal" })}
          </div>
          <p className="text-muted-foreground text-xs">
            A big, light box can cost more than its weight suggests. Add the size for a closer number.
          </p>
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="categorySlug">Category</Label>
            <NativeSelect id="categorySlug" name="categorySlug" defaultValue={values.categorySlug}>
              <option value="">Choose a category</option>
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
            {errors.categorySlug ? (
              <p className="text-destructive text-xs">{errors.categorySlug.join(" ")}</p>
            ) : null}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="corridorId">Ships from</Label>
            <NativeSelect id="corridorId" name="corridorId" defaultValue={values.corridorId}>
              {options.corridors.map((corridor) => (
                <option key={corridor.id} value={corridor.id}>
                  {corridor.name}
                </option>
              ))}
            </NativeSelect>
            {errors.corridorId ? (
              <p className="text-destructive text-xs">{errors.corridorId.join(" ")}</p>
            ) : null}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="destinationState">Deliver to (state)</Label>
            <NativeSelect
              id="destinationState"
              name="destinationState"
              defaultValue={values.destinationState}
            >
              {options.states.map((state) => (
                <option key={state} value={state}>
                  {state}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="buyerCurrency">Show the total in</Label>
            <NativeSelect id="buyerCurrency" name="buyerCurrency" defaultValue={values.buyerCurrency}>
              {currencyOptions}
            </NativeSelect>
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="specialHandling"
            className="size-4"
            defaultChecked={values.specialHandling}
          />
          Large battery, fragile or oversized (special handling)
        </label>

        <div>
          <Button type="submit" size="lg">
            Work out the price
          </Button>
        </div>
      </form>

      {submitted && Object.keys(errors).length > 0 ? (
        <Alert variant="destructive" aria-live="polite">
          Please check the highlighted fields.
        </Alert>
      ) : null}
      {failure ? (
        <Alert aria-live="polite">
          <p>{failure}</p>
          <p className="mt-2">
            <Link href="/order/link" className="text-primary underline">
              Ask for an exact quote
            </Link>
          </p>
        </Alert>
      ) : null}

      {view && resultCurrency ? (
        <section aria-labelledby="result-heading" className="grid gap-4 rounded-xl border p-4">
          <h2 id="result-heading" className="text-lg font-semibold">
            Your estimate
          </h2>
          <CalcResult view={view} currency={resultCurrency} />
          <p className="text-muted-foreground text-xs">
            This is an estimate from today&apos;s exchange rates and our current rates. An exact quote fixes
            the price for up to 72 hours. Copy this page&apos;s link to share the numbers.
          </p>
          <div>
            <Link href="/order/link" className={buttonVariants({ size: "lg" })}>
              Get an exact quote
            </Link>
          </div>
        </section>
      ) : null}
    </div>
  );
}
