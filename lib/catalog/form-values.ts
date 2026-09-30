import { minorToDecimalString } from "@/lib/money";
import type { Tables } from "@/lib/supabase/database.types";
import type { ProductCondition } from "./schemas";

/** Product form fields as the form holds them: everything typed is text. */
export type ProductFormValues = {
  title: string;
  description: string;
  brand: string;
  category: string;
  condition: ProductCondition;
  conditionNotes: string;
  price: string;
  currency: string;
  stock: string;
  weightGrams: string;
  corridorId: string;
  warrantyMonths: string;
  requiresSpecialHandling: boolean;
  specs: { key: string; value: string }[];
};

export function emptyProductValues(currency: string, corridorId: string): ProductFormValues {
  return {
    title: "",
    description: "",
    brand: "",
    category: "",
    condition: "new",
    conditionNotes: "",
    price: "",
    currency,
    stock: "1",
    weightGrams: "",
    corridorId,
    warrantyMonths: "0",
    requiresSpecialHandling: false,
    specs: [{ key: "", value: "" }],
  };
}

/** Specs are stored as a JSON object of text values. Anything else is ignored. */
export function specsToRows(specs: unknown): { key: string; value: string }[] {
  if (!specs || typeof specs !== "object" || Array.isArray(specs)) return [];
  return Object.entries(specs as Record<string, unknown>).flatMap(([key, value]) =>
    typeof value === "string" ? [{ key, value }] : [],
  );
}

/** A stored product as form values. The price is shown in normal units ("1299.50"). */
export function productToFormValues(
  product: Pick<
    Tables<"products">,
    | "title"
    | "description"
    | "brand"
    | "category"
    | "condition"
    | "condition_notes"
    | "price_minor"
    | "currency"
    | "stock"
    | "weight_grams"
    | "corridor_id"
    | "warranty_months"
    | "requires_special_handling"
    | "specs"
  >,
  currencyDigits: Readonly<Record<string, number>>,
): ProductFormValues {
  const rows = specsToRows(product.specs);
  return {
    title: product.title,
    description: product.description,
    brand: product.brand ?? "",
    category: product.category,
    condition: product.condition,
    conditionNotes: product.condition_notes ?? "",
    price: minorToDecimalString(product.price_minor, currencyDigits[product.currency] ?? 2),
    currency: product.currency,
    stock: String(product.stock),
    weightGrams: product.weight_grams === null ? "" : String(product.weight_grams),
    corridorId: product.corridor_id,
    warrantyMonths: String(product.warranty_months),
    requiresSpecialHandling: product.requires_special_handling,
    specs: rows.length > 0 ? rows : [{ key: "", value: "" }],
  };
}
