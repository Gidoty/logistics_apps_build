import { z } from "zod";
import { wholeNumber, fieldErrorsFromIssues } from "@/lib/validation";
import { pricingSnapshotSchema } from "@/lib/pricing/snapshot-schema";
import { LINE_TYPES } from "@/lib/pricing/types";

/**
 * Quote line types, labels and the schema for sending a quote. Lines come
 * from the pricing engine (lib/pricing); the admin can override any of them
 * with a reason (lib/orders/quote-reconcile.ts). There is no total in the
 * input: the database adds the lines up.
 */
export const QUOTE_LINE_TYPES = [
  "item_price",
  "service_fee",
  "international_freight",
  "insurance",
  "import_duty",
  "other_levies",
  "vat",
  "customs_estimate",
  "clearing",
  "special_handling",
  "last_mile_delivery",
  "payment_processing",
  "fx_spread",
  "other",
] as const;
export type QuoteLineType = (typeof QUOTE_LINE_TYPES)[number];

export const QUOTE_LINE_LABELS: Record<QuoteLineType, string> = {
  item_price: "Item price",
  service_fee: "Service fee",
  international_freight: "International freight",
  insurance: "Insurance",
  import_duty: "Import duty",
  other_levies: "Other customs levies",
  vat: "VAT on imports",
  customs_estimate: "Customs and clearing (estimate)",
  clearing: "Customs clearing",
  special_handling: "Special handling",
  last_mile_delivery: "Delivery in Nigeria",
  payment_processing: "Payment processing",
  fx_spread: "Currency conversion fee",
  other: "Other",
};

/** Lines that are customs estimates: buyers see them marked as estimates. */
export const ESTIMATED_LINE_TYPES: readonly QuoteLineType[] = [
  "import_duty",
  "other_levies",
  "vat",
  "customs_estimate",
];

export const EXPIRY_OPTIONS = [24, 48, 72] as const;
export const DEFAULT_EXPIRY_HOURS = 48;
export const MAX_QUOTE_LINES = 30;

/** A calculation older than this must be run again before a quote is sent. */
export const MAX_CALCULATION_AGE_MS = 60 * 60 * 1000;

export function sumLines(lines: readonly { amountMinor: number }[]): number {
  return lines.reduce((total, line) => total + line.amountMinor, 0);
}

export function isOverBudget(totalMinor: number, maxBudgetMinor: number | null | undefined): boolean {
  return maxBudgetMinor != null && totalMinor > maxBudgetMinor;
}

const submittedLine = z.object({
  calcType: z.enum(LINE_TYPES).nullable(),
  label: z.string().max(200).default(""),
  amount: z.string().max(30),
  reason: z.string().max(500).default(""),
});

/** What the admin quote form sends to send. The snapshot is the one the Calculate step returned. */
export const sendQuoteInputSchema = z.object({
  orderId: z.uuid("Invalid order."),
  snapshot: pricingSnapshotSchema,
  lines: z.array(submittedLine).min(1, "Calculate the quote first.").max(MAX_QUOTE_LINES),
  expiresInHours: wholeNumber("Expiry", 24, 72).refine(
    (hours) => (EXPIRY_OPTIONS as readonly number[]).includes(hours),
    "Choose 24, 48 or 72 hours.",
  ),
  internalNotes: z.string().trim().max(2000, "Notes can have up to 2000 characters.").default(""),
  confirmOverBudget: z.boolean().default(false),
});
export type SendQuoteInput = z.output<typeof sendQuoteInputSchema>;

export { fieldErrorsFromIssues };
