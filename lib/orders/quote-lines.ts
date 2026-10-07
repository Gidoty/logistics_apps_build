import { z } from "zod";
import { MAX_PRICE_MINOR, parseMoneyInput } from "@/lib/money";
import { fieldErrorsFromIssues, wholeNumber } from "@/lib/validation";

/**
 * Quote lines and the quote form. The browser form and the server action use
 * the same schema, and the database function send_quote() checks everything
 * again and works out the total itself: no total is ever sent from the browser.
 *
 * TODO Batch 4: the pricing engine replaces manual entry of these lines.
 */

export const QUOTE_LINE_TYPES = [
  "item_price",
  "service_fee",
  "international_freight",
  "customs_estimate",
  "last_mile_delivery",
  "other",
] as const;
export type QuoteLineType = (typeof QUOTE_LINE_TYPES)[number];

export const QUOTE_LINE_LABELS: Record<QuoteLineType, string> = {
  item_price: "Item price",
  service_fee: "Service fee",
  international_freight: "International freight",
  customs_estimate: "Customs and clearing (estimate)",
  last_mile_delivery: "Delivery in Nigeria",
  other: "Other",
};

export const EXPIRY_OPTIONS = [24, 48, 72] as const;
export const DEFAULT_EXPIRY_HOURS = 48;
export const MAX_QUOTE_LINES = 20;

export type QuoteLine = { type: QuoteLineType; label: string; amountMinor: number };

export function sumLines(lines: readonly { amountMinor: number }[]): number {
  return lines.reduce((total, line) => total + line.amountMinor, 0);
}

export function isOverBudget(totalMinor: number, maxBudgetMinor: number | null | undefined): boolean {
  return maxBudgetMinor != null && totalMinor > maxBudgetMinor;
}

export type QuoteFormContext = {
  /** Decimal places of the order's currency. Amounts are typed in this currency. */
  currencyDigits: number;
  /** The buyer's budget in minor units, if they gave one. */
  maxBudgetMinor: number | null;
  /** True when the order has no route yet (unknown store): admin must choose one. */
  needsCorridor: boolean;
  /** Ids of active routes that admin may choose. */
  corridorIds: readonly string[];
};

const lineInputSchema = z.object({
  type: z.enum(QUOTE_LINE_TYPES, "Choose a line type."),
  label: z
    .string()
    .trim()
    .min(1, "Give each line a label.")
    .max(200, "Labels can have up to 200 characters."),
  amount: z.string().default(""),
});

export type QuoteInput = {
  orderId: string;
  lines: QuoteLine[];
  totalMinor: number;
  expiresInHours: (typeof EXPIRY_OPTIONS)[number];
  weightGrams: number | null;
  internalNotes: string | null;
  corridorId: string | null;
  confirmOverBudget: boolean;
};

/** Schema for the admin quote builder. The total in the output is worked out here, from the lines. */
export function createQuoteSchema(context: QuoteFormContext) {
  return z
    .object({
      orderId: z.uuid("Invalid order."),
      lines: z
        .array(lineInputSchema)
        .min(1, "Add at least one line.")
        .max(MAX_QUOTE_LINES, `Add at most ${MAX_QUOTE_LINES} lines.`),
      expiresInHours: wholeNumber("Expiry", 24, 72).refine(
        (hours) => (EXPIRY_OPTIONS as readonly number[]).includes(hours),
        "Choose 24, 48 or 72 hours.",
      ),
      weightGrams: z
        .union([z.string(), z.number()])
        .default("")
        .transform((value, ctx) => {
          const text = String(value).trim();
          if (text === "") return null;
          if (!/^\d{1,6}$/.test(text) || Number(text) < 1 || Number(text) > 500_000) {
            ctx.addIssue({ code: "custom", message: "Weight must be between 1 and 500000 grams." });
            return z.NEVER;
          }
          return Number(text);
        }),
      internalNotes: z.string().trim().max(2000, "Notes can have up to 2000 characters.").default(""),
      corridorId: z.string().default(""),
      confirmOverBudget: z.boolean().default(false),
    })
    .transform((data, ctx): QuoteInput => {
      const lines: QuoteLine[] = [];
      data.lines.forEach((line, index) => {
        const amount = parseMoneyInput(line.amount, context.currencyDigits, { allowZero: true });
        if (!amount.ok) {
          ctx.addIssue({
            code: "custom",
            path: ["lines", index, "amount"],
            message: `Line ${index + 1}: ${amount.error}`,
          });
          return;
        }
        lines.push({ type: line.type, label: line.label, amountMinor: amount.minor });
      });
      // Line errors are reported on the "lines" field with the row number.
      if (lines.length !== data.lines.length) return z.NEVER;

      if (!lines.some((line) => line.type === "item_price" && line.amountMinor > 0)) {
        ctx.addIssue({ code: "custom", path: ["lines"], message: "Add an item price line above zero." });
      }
      const totalMinor = sumLines(lines);
      if (totalMinor > MAX_PRICE_MINOR)
        ctx.addIssue({ code: "custom", path: ["lines"], message: "The total is too large." });
      if (totalMinor <= 0)
        ctx.addIssue({ code: "custom", path: ["lines"], message: "The total must be above zero." });

      let corridorId: string | null = null;
      if (context.needsCorridor) {
        if (!context.corridorIds.includes(data.corridorId)) {
          ctx.addIssue({
            code: "custom",
            path: ["corridorId"],
            message: "Choose the shipping route for this store.",
          });
        } else {
          corridorId = data.corridorId;
        }
      }

      if (isOverBudget(totalMinor, context.maxBudgetMinor) && !data.confirmOverBudget) {
        ctx.addIssue({
          code: "custom",
          path: ["confirmOverBudget"],
          message: "The total is over the buyer's budget. Tick the box to send it anyway.",
        });
      }

      return {
        orderId: data.orderId,
        lines,
        totalMinor,
        expiresInHours: data.expiresInHours as QuoteInput["expiresInHours"],
        weightGrams: data.weightGrams,
        internalNotes: data.internalNotes === "" ? null : data.internalNotes,
        corridorId,
        confirmOverBudget: data.confirmOverBudget,
      };
    });
}

export { fieldErrorsFromIssues };

/** A row of the admin quote form: the amount is text as typed. */
export type QuoteFormRow = { type: QuoteLineType; label: string; amount: string };

/** The rows a new quote starts with. Admin removes or adds lines as needed. */
export const STARTER_LINES: readonly QuoteFormRow[] = [
  { type: "item_price", label: "Item price", amount: "" },
  { type: "service_fee", label: "Service fee", amount: "0" },
  { type: "international_freight", label: "International freight", amount: "0" },
  { type: "customs_estimate", label: "Customs duty and clearing (estimate)", amount: "0" },
  { type: "last_mile_delivery", label: "Delivery in Nigeria", amount: "0" },
];
