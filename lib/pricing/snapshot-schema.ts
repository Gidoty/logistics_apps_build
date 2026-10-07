import { z } from "zod";
import { CALC_METHODS, FEE_TYPES, LINE_TYPES, type PricingSnapshot } from "./types";

const numeric = z.union([z.string().regex(/^\d+(\.\d+)?$/), z.number().finite().nonnegative()]);
const iso = z.string().refine((value) => !Number.isNaN(new Date(value).getTime()), "Invalid date");
const code = z.string().regex(/^[A-Z]{3}$/);

const feeRule = z.object({
  id: z.string().min(1),
  corridorId: z.string().min(1),
  feeType: z.enum(FEE_TYPES),
  calcMethod: z.enum(CALC_METHODS),
  value: numeric,
  currency: code,
  minAmountMinor: numeric.nullable(),
  maxAmountMinor: numeric.nullable(),
  weightFromG: z.number().int().nonnegative().nullable(),
  weightToG: z.number().int().positive().nullable(),
  categorySlug: z.string().nullable(),
  zoneId: z.string().nullable(),
  effectiveFrom: iso,
  effectiveTo: iso.nullable(),
});

const dutyRate = z.object({
  id: z.string().min(1),
  corridorId: z.string().min(1),
  categorySlug: z.string().nullable(),
  importDutyPercent: numeric,
  vatPercent: numeric,
  otherLeviesPercent: numeric,
  effectiveFrom: iso,
  effectiveTo: iso.nullable(),
});

const fxRow = z.object({
  id: z.string().min(1),
  base: code,
  quote: code,
  rate: numeric,
  source: z.string(),
  isOverride: z.boolean(),
  endedAt: iso.nullable().optional(),
  fetchedAt: iso,
  spreadPercent: numeric,
});

/** The pricing snapshot as it comes back from a browser. Checked before anything is replayed or stored. */
export const pricingSnapshotSchema = z.object({
  engine_version: z.string().min(1).max(40),
  input: z.object({
    now: iso,
    itemUnitPriceMinor: z.number().int().positive(),
    itemCurrency: code,
    quantity: z.number().int().positive(),
    actualWeightGrams: z.number().int().positive(),
    dimensionsCm: z
      .object({ length: z.number().positive(), width: z.number().positive(), height: z.number().positive() })
      .nullable(),
    categorySlug: z.string().min(1),
    corridor: z.object({
      id: z.string().min(1),
      name: z.string(),
      originCountry: z.string().length(2),
      destinationCountry: z.string().length(2),
    }),
    destinationState: z.string().min(1),
    buyerCurrency: code,
    specialHandling: z.boolean(),
  }),
  data: z.object({
    feeRules: z.array(feeRule).max(100),
    dutyRates: z.array(dutyRate).max(20),
    zones: z.array(z.object({ id: z.string(), name: z.string(), states: z.array(z.string()) })).max(10),
    categories: z.array(z.object({ slug: z.string(), parentSlug: z.string().nullable() })).max(20),
    currencies: z.array(z.object({ code, minorUnitDigits: z.number().int().min(0).max(6) })).max(20),
    fxRows: z.array(fxRow).max(40),
  }),
  output: z.object({
    lines: z
      .array(
        z.object({
          type: z.enum(LINE_TYPES),
          label: z.string(),
          amountMinor: z.number().int().nonnegative(),
        }),
      )
      .max(30),
    total: z.number().int().nonnegative(),
    currency: code,
  }),
}) satisfies z.ZodType<PricingSnapshot>;
