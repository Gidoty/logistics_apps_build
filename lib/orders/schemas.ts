import { z } from "zod";
import { parseMoneyInput } from "@/lib/money";
import { parseProductUrl } from "./store-domains";
import { wholeNumber } from "@/lib/validation";

export const DECLINE_REASONS = [
  "prohibited_item",
  "out_of_stock",
  "unsupported_store",
  "cannot_verify_seller",
  "other",
] as const;
export type DeclineReason = (typeof DECLINE_REASONS)[number];

export const DECLINE_REASON_LABELS: Record<DeclineReason, string> = {
  prohibited_item: "Prohibited item",
  out_of_stock: "Out of stock",
  unsupported_store: "Unsupported store",
  cannot_verify_seller: "Cannot verify the seller",
  other: "Other",
};

export const MAX_QUANTITY = 100;

/** What the link request form is checked against. */
export type LinkOrderContext = {
  /** Active currencies and their decimal places. */
  currencies: Readonly<Record<string, number>>;
};

/**
 * The buyer's link request, shared by the form and the server action.
 * The link may be a whole sentence pasted from a phone's share button: the
 * first link in it is used. Whether the store is supported is decided
 * separately, from the store_domains table.
 */
export function createLinkOrderSchema(context: LinkOrderContext) {
  return z
    .object({
      productUrl: z.string().max(4000, "That is too long. Paste only the link."),
      quantity: wholeNumber("Quantity", 1, MAX_QUANTITY),
      variantNotes: z.string().trim().max(500, "Keep this under 500 characters.").default(""),
      buyerNotes: z.string().trim().max(1000, "Keep this under 1000 characters.").default(""),
      maxBudget: z.string().default(""),
      buyerCurrency: z.string().trim().toUpperCase(),
      recipientId: z.uuid("Choose a recipient."),
    })
    .transform((data, ctx) => {
      const url = parseProductUrl(data.productUrl);
      if (!url.ok) ctx.addIssue({ code: "custom", path: ["productUrl"], message: url.error });

      if (!Object.hasOwn(context.currencies, data.buyerCurrency)) {
        ctx.addIssue({ code: "custom", path: ["buyerCurrency"], message: "Choose a currency." });
      }

      let maxBudgetMinor: number | null = null;
      if (data.maxBudget.trim() !== "") {
        const digits = context.currencies[data.buyerCurrency] ?? 2;
        const budget = parseMoneyInput(data.maxBudget, digits);
        if (budget.ok) maxBudgetMinor = budget.minor;
        else ctx.addIssue({ code: "custom", path: ["maxBudget"], message: budget.error });
      }

      if (!url.ok) return z.NEVER;
      return {
        sourceUrl: url.href,
        host: url.host,
        quantity: data.quantity,
        variantNotes: data.variantNotes === "" ? null : data.variantNotes,
        buyerNotes: data.buyerNotes === "" ? null : data.buyerNotes,
        maxBudgetMinor,
        buyerCurrency: data.buyerCurrency,
        recipientId: data.recipientId,
      };
    });
}

export type LinkOrderInput = z.output<ReturnType<typeof createLinkOrderSchema>>;

export const messageBodySchema = z
  .string()
  .trim()
  .min(1, "Write a message first.")
  .max(1000, "Messages can have up to 1000 characters.");

export const orderIdSchema = z.uuid("Invalid order.");

export const declineOrderSchema = z
  .object({
    orderId: z.uuid("Invalid order."),
    reason: z.enum(DECLINE_REASONS, "Choose a reason."),
    note: z.string().trim().max(500, "The note is too long.").default(""),
  })
  .superRefine((data, ctx) => {
    if (data.reason === "other" && data.note.length < 5) {
      ctx.addIssue({
        code: "custom",
        path: ["note"],
        message: "Explain the reason in at least 5 characters.",
      });
    }
  });
