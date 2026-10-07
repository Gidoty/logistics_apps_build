import { z } from "zod";
import { parseMoneyInput } from "@/lib/money";
import { fieldErrorsFromIssues } from "@/lib/validation";
import { CALC_METHODS, FEE_TYPES } from "./types";

export { fieldErrorsFromIssues };

/** Fee types an admin can set rules for. fx_spread lives on the exchange rates, not in a rule. */
export const EDITABLE_FEE_TYPES = FEE_TYPES.filter((type) => type !== "fx_spread");

export const FEE_TYPE_LABELS: Record<(typeof FEE_TYPES)[number], string> = {
  service_fee: "Service fee",
  international_freight: "International freight",
  clearing: "Customs clearing",
  last_mile: "Last-mile delivery",
  special_handling: "Special handling",
  insurance: "Insurance",
  fx_spread: "Conversion fee",
  payment_processing: "Payment processing",
};

export const CALC_METHOD_LABELS = {
  flat: "Flat amount",
  percent: "Percent",
  per_kg: "Per kilogram",
} as const;

export type PricingAdminContext = {
  currencies: Readonly<Record<string, number>>;
  corridorIds: readonly string[];
  categorySlugs: readonly string[];
  zoneIds: readonly string[];
};

const optionalInt = (label: string, max: number) =>
  z
    .string()
    .default("")
    .transform((value, ctx) => {
      const text = value.trim();
      if (text === "") return null;
      if (!/^\d{1,7}$/.test(text) || Number(text) > max) {
        ctx.addIssue({ code: "custom", message: `${label} must be a whole number up to ${max}.` });
        return z.NEVER;
      }
      return Number(text);
    });

const PERCENT = /^\d{1,3}(\.\d{1,4})?$/;

function percentValue(text: string, label: string, ctx: z.RefinementCtx, path: string): number | null {
  const trimmed = text.trim();
  if (!PERCENT.test(trimmed) || Number(trimmed) > 100) {
    ctx.addIssue({
      code: "custom",
      path: [path],
      message: `${label} must be between 0 and 100, with up to 4 decimals.`,
    });
    return null;
  }
  return Number(trimmed);
}

const ruleFields = {
  calcMethod: z.enum(CALC_METHODS, "Choose how the fee is worked out."),
  value: z.string().default(""),
  currency: z.string().trim().toUpperCase(),
  minAmount: z.string().default(""),
  maxAmount: z.string().default(""),
  weightFromG: optionalInt("Weight from", 1_000_000),
  weightToG: optionalInt("Weight to", 1_000_000),
  notes: z.string().trim().max(500, "Notes can have up to 500 characters.").default(""),
};

type RuleFieldsOutput = {
  calcMethod: (typeof CALC_METHODS)[number];
  value: number;
  currency: string;
  minAmountMinor: number | null;
  maxAmountMinor: number | null;
  weightFromG: number | null;
  weightToG: number | null;
  notes: string | null;
};

function readRuleFields(
  data: {
    calcMethod: (typeof CALC_METHODS)[number];
    value: string;
    currency: string;
    minAmount: string;
    maxAmount: string;
    weightFromG: number | null;
    weightToG: number | null;
    notes: string;
  },
  context: PricingAdminContext,
  ctx: z.RefinementCtx,
): RuleFieldsOutput | null {
  const digits = context.currencies[data.currency];
  if (digits === undefined) {
    ctx.addIssue({ code: "custom", path: ["currency"], message: "Choose a currency." });
    return null;
  }
  let value: number | null = null;
  if (data.calcMethod === "percent") {
    value = percentValue(data.value, "The percent", ctx, "value");
  } else {
    const amount = parseMoneyInput(data.value, digits, { allowZero: true });
    if (amount.ok) value = amount.minor;
    else ctx.addIssue({ code: "custom", path: ["value"], message: amount.error });
  }
  const bound = (text: string, path: string): number | null => {
    if (text.trim() === "") return null;
    const parsed = parseMoneyInput(text, digits, { allowZero: true });
    if (parsed.ok) return parsed.minor;
    ctx.addIssue({ code: "custom", path: [path], message: parsed.error });
    return null;
  };
  const min = bound(data.minAmount, "minAmount");
  const max = bound(data.maxAmount, "maxAmount");
  if (min !== null && max !== null && min > max)
    ctx.addIssue({
      code: "custom",
      path: ["minAmount"],
      message: "The minimum cannot be above the maximum.",
    });
  if (data.weightFromG !== null && data.weightToG !== null && data.weightToG <= data.weightFromG)
    ctx.addIssue({
      code: "custom",
      path: ["weightToG"],
      message: "The band must end above where it starts.",
    });
  if (value === null) return null;
  return {
    calcMethod: data.calcMethod,
    value,
    currency: data.currency,
    minAmountMinor: min,
    maxAmountMinor: max,
    weightFromG: data.weightFromG,
    weightToG: data.weightToG,
    notes: data.notes === "" ? null : data.notes,
  };
}

/** A new fee rule. What it applies to (route, fee, category, zone) is chosen here and fixed after. */
export function createFeeRuleSchema(context: PricingAdminContext) {
  return z
    .object({
      corridorId: z.string().trim(),
      feeType: z.enum(EDITABLE_FEE_TYPES as [string, ...string[]], "Choose a fee."),
      categorySlug: z.string().trim().default(""),
      zoneId: z.string().trim().default(""),
      ...ruleFields,
    })
    .transform((data, ctx) => {
      if (!context.corridorIds.includes(data.corridorId))
        ctx.addIssue({ code: "custom", path: ["corridorId"], message: "Choose a route." });
      if (data.categorySlug !== "" && !context.categorySlugs.includes(data.categorySlug))
        ctx.addIssue({ code: "custom", path: ["categorySlug"], message: "Choose a category from the list." });
      if (data.feeType === "last_mile" && !context.zoneIds.includes(data.zoneId))
        ctx.addIssue({ code: "custom", path: ["zoneId"], message: "Last-mile rules need a delivery zone." });
      if (data.feeType !== "last_mile" && data.zoneId !== "")
        ctx.addIssue({ code: "custom", path: ["zoneId"], message: "Only last-mile rules have a zone." });
      const fields = readRuleFields(data, context, ctx);
      if (!fields) return z.NEVER;
      return {
        corridorId: data.corridorId,
        feeType: data.feeType as (typeof EDITABLE_FEE_TYPES)[number],
        categorySlug: data.categorySlug === "" ? null : data.categorySlug,
        zoneId: data.zoneId === "" ? null : data.zoneId,
        ...fields,
      };
    });
}

/** Changing a rate. The old rule is closed and this becomes a new rule; the scope stays the same. */
export function replaceFeeRuleSchema(context: PricingAdminContext) {
  return z.object({ ruleId: z.uuid("Rule not found."), ...ruleFields }).transform((data, ctx) => {
    const fields = readRuleFields(data, context, ctx);
    if (!fields) return z.NEVER;
    return { ruleId: data.ruleId, ...fields };
  });
}

const dutyFields = {
  importDutyPercent: z.string().default(""),
  vatPercent: z.string().default(""),
  otherLeviesPercent: z.string().default(""),
  notes: z.string().trim().max(500, "Notes can have up to 500 characters.").default(""),
};

function readDutyFields(
  data: { importDutyPercent: string; vatPercent: string; otherLeviesPercent: string; notes: string },
  ctx: z.RefinementCtx,
) {
  const duty = percentValue(data.importDutyPercent, "Import duty", ctx, "importDutyPercent");
  const vat = percentValue(data.vatPercent, "VAT", ctx, "vatPercent");
  const levies = percentValue(data.otherLeviesPercent, "Other levies", ctx, "otherLeviesPercent");
  if (duty === null || vat === null || levies === null) return null;
  return {
    importDutyPercent: duty,
    vatPercent: vat,
    otherLeviesPercent: levies,
    notes: data.notes === "" ? null : data.notes,
  };
}

export function createDutyRateSchema(context: PricingAdminContext) {
  return z
    .object({ corridorId: z.string().trim(), categorySlug: z.string().trim().default(""), ...dutyFields })
    .transform((data, ctx) => {
      if (!context.corridorIds.includes(data.corridorId))
        ctx.addIssue({ code: "custom", path: ["corridorId"], message: "Choose a route." });
      if (data.categorySlug !== "" && !context.categorySlugs.includes(data.categorySlug))
        ctx.addIssue({ code: "custom", path: ["categorySlug"], message: "Choose a category from the list." });
      const fields = readDutyFields(data, ctx);
      if (!fields) return z.NEVER;
      return {
        corridorId: data.corridorId,
        categorySlug: data.categorySlug === "" ? null : data.categorySlug,
        ...fields,
      };
    });
}

export const replaceDutyRateSchema = z
  .object({ ruleId: z.uuid("Rate not found."), ...dutyFields })
  .transform((data, ctx) => {
    const fields = readDutyFields(data, ctx);
    if (!fields) return z.NEVER;
    return { ruleId: data.ruleId, ...fields };
  });

export const zoneSchema = (validStates: readonly string[]) =>
  z
    .object({
      zoneId: z.string().trim().default(""),
      name: z.string().trim().min(1, "Give the zone a name.").max(80, "The name is too long."),
      states: z.array(z.string()).min(1, "Pick at least one state."),
    })
    .transform((data, ctx) => {
      if (data.zoneId !== "" && !z.uuid().safeParse(data.zoneId).success)
        ctx.addIssue({ code: "custom", path: ["zoneId"], message: "Zone not found." });
      const bad = data.states.filter((state) => !validStates.includes(state));
      if (bad.length > 0)
        ctx.addIssue({
          code: "custom",
          path: ["states"],
          message: `Not a Nigerian state: ${bad.join(", ")}`,
        });
      return {
        zoneId: data.zoneId === "" ? null : data.zoneId,
        name: data.name,
        states: [...new Set(data.states)],
      };
    });

export const fxOverrideSchema = z.object({
  quote: z.string().regex(/^[A-Z]{3}$/, "Choose a currency."),
  rate: z
    .string()
    .trim()
    .regex(/^\d{1,10}(\.\d{1,8})?$/, "Enter a rate above zero, with up to 8 decimals.")
    .refine((value) => Number(value) > 0, "Enter a rate above zero."),
});

export const fxSpreadSchema = z.object({
  quote: z.string().regex(/^[A-Z]{3}$/, "Choose a currency."),
  spread: z
    .string()
    .trim()
    .regex(/^\d{1,2}(\.\d{1,4})?$/, "Enter a percent from 0 to 20, with up to 4 decimals.")
    .refine((value) => Number(value) <= 20, "The conversion fee cannot be above 20 percent."),
});
