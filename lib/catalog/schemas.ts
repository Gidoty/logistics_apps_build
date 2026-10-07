import { z } from "zod";
import { parseMoneyInput } from "@/lib/money";
import { fieldErrorsFromIssues, optionalDimensionCm, wholeNumber } from "@/lib/validation";
import { Constants, type Enums } from "@/lib/supabase/database.types";

export type ProductCondition = Enums<"product_condition">;

export const PRODUCT_CONDITIONS = Constants.public.Enums.product_condition;

export const CONDITION_LABELS: Record<ProductCondition, string> = {
  new: "New",
  open_box: "Open box",
  refurbished: "Refurbished",
  used: "Used",
};

export const MAX_SPECS = 20;

/** What the schema checks input against. Loaded from the database (lib/catalog/context.ts). */
export type ProductFormContext = {
  /** Slugs of categories listings may use: active, not prohibited, no sub-categories. */
  categories: readonly string[];
  /** Active currencies and their decimal places: { NGN: 2, USD: 2, ... }. */
  currencies: Readonly<Record<string, number>>;
  /** Ids of active corridors that start in the vendor's country. */
  corridorIds: readonly string[];
};

export type ProductInput = {
  title: string;
  description: string;
  brand: string | null;
  category: string;
  condition: ProductCondition;
  conditionNotes: string | null;
  priceMinor: number;
  currency: string;
  stock: number;
  weightGrams: number;
  /** Box size of one packed unit, all three or none. */
  lengthCm: number | null;
  widthCm: number | null;
  heightCm: number | null;
  corridorId: string;
  warrantyMonths: number;
  requiresSpecialHandling: boolean;
  specs: Record<string, string>;
};

const specRowSchema = z.object({
  key: z.string().trim().max(40, "Spec names can have up to 40 characters."),
  value: z.string().trim().max(100, "Spec values can have up to 100 characters."),
});

// Blank rows are ignored. A row with only a name or only a value is an error.
// Names are compared ignoring case, so "RAM" and "ram" count as duplicates.
const specsSchema = z
  .array(specRowSchema)
  .max(MAX_SPECS, `Add at most ${MAX_SPECS} specs.`)
  .default([])
  .transform((rows, ctx) => {
    const specs: Record<string, string> = {};
    const seen = new Set<string>();
    for (const row of rows) {
      if (row.key === "" && row.value === "") continue;
      if (row.key === "" || row.value === "") {
        ctx.addIssue({ code: "custom", message: "Each spec needs a name and a value." });
        return z.NEVER;
      }
      const id = row.key.toLowerCase();
      if (seen.has(id)) {
        ctx.addIssue({ code: "custom", message: `"${row.key}" is listed twice.` });
        return z.NEVER;
      }
      seen.add(id);
      specs[row.key] = row.value;
    }
    return specs;
  });

/**
 * Product form schema, shared by the browser form and the server action.
 * Amounts are typed in normal units ("1,299.50") and come out as minor units.
 */
export function createProductSchema(context: ProductFormContext) {
  return z
    .object({
      title: z.string().trim().min(2, "Enter a title.").max(200, "Title is too long."),
      description: z
        .string()
        .trim()
        .min(10, "Describe the product in at least 10 characters.")
        .max(10000, "Description is too long."),
      brand: z.string().trim().max(80, "Brand is too long.").default(""),
      category: z
        .string()
        .refine((value) => context.categories.includes(value), "Choose a category from the list."),
      condition: z.enum(PRODUCT_CONDITIONS, "Choose the condition."),
      conditionNotes: z.string().trim().max(1000, "Notes are too long.").default(""),
      price: z.string().default(""),
      currency: z.string().refine((value) => Object.hasOwn(context.currencies, value), "Choose a currency."),
      stock: wholeNumber("Stock", 0, 1_000_000),
      weightGrams: wholeNumber("Weight", 1, 500_000),
      lengthCm: optionalDimensionCm("Length"),
      widthCm: optionalDimensionCm("Width"),
      heightCm: optionalDimensionCm("Height"),
      corridorId: z
        .string()
        .refine((value) => context.corridorIds.includes(value), "Choose a shipping route."),
      warrantyMonths: wholeNumber("Warranty", 0, 120).default(0),
      requiresSpecialHandling: z.boolean().default(false),
      specs: specsSchema,
    })
    .transform((data, ctx): ProductInput => {
      const digits = context.currencies[data.currency] ?? 2;
      const price = parseMoneyInput(data.price, digits);
      if (!price.ok) ctx.addIssue({ code: "custom", path: ["price"], message: price.error });

      if (data.condition !== "new" && data.conditionNotes.length < 10) {
        ctx.addIssue({
          code: "custom",
          path: ["conditionNotes"],
          message: "Describe the condition (at least 10 characters), for example scratches or missing parts.",
        });
      }
      const sizes = [data.lengthCm, data.widthCm, data.heightCm];
      const given = sizes.filter((size) => size !== null).length;
      if (given !== 0 && given !== 3) {
        ctx.addIssue({
          code: "custom",
          path: ["lengthCm"],
          message: "Give all three sizes (length, width, height) or leave all three empty.",
        });
      }
      if (!price.ok || (given !== 0 && given !== 3)) return z.NEVER;

      return {
        title: data.title,
        description: data.description,
        brand: data.brand === "" ? null : data.brand,
        category: data.category,
        condition: data.condition,
        conditionNotes: data.conditionNotes === "" ? null : data.conditionNotes,
        priceMinor: price.minor,
        currency: data.currency,
        stock: data.stock,
        weightGrams: data.weightGrams,
        lengthCm: data.lengthCm,
        widthCm: data.widthCm,
        heightCm: data.heightCm,
        corridorId: data.corridorId,
        warrantyMonths: data.warrantyMonths,
        requiresSpecialHandling: data.requiresSpecialHandling,
        specs: data.specs,
      };
    });
}

export { fieldErrorsFromIssues };
