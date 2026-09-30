import { z } from "zod";
import { countryCodeSchema } from "@/lib/auth/schemas";
import { normalizePhone } from "@/lib/profile/phone";
import { parseVendorDocumentPath } from "@/lib/storage/vendor-documents";

/** What the application form is checked against. Loaded from the database. */
export type VendorApplicationContext = {
  /** Codes of countries a vendor may operate from. */
  countries: readonly string[];
  /** Slugs of categories listings may use. */
  categories: readonly string[];
  /** The signed-in user. The ID document must sit in their own storage folder. */
  userId: string;
};

const requiredPhone = z
  .string()
  .trim()
  .transform((value, ctx) => {
    const normalized = normalizePhone(value);
    if (!normalized) {
      ctx.addIssue({
        code: "custom",
        message: "Use international format with country code, for example +2348031234567.",
      });
      return z.NEVER;
    }
    return normalized;
  });

/** Vendor application, shared by the form (browser) and the server action. */
export function createVendorApplicationSchema(context: VendorApplicationContext) {
  return z.object({
    businessName: z
      .string()
      .trim()
      .min(2, "Enter your business name.")
      .max(120, "Business name is too long."),
    countryCode: countryCodeSchema.refine(
      (code) => context.countries.includes(code),
      "Choose a country from the list.",
    ),
    city: z.string().trim().min(1, "Enter your city.").max(80, "City name is too long."),
    phone: requiredPhone,
    businessRegNumber: z
      .string()
      .trim()
      .max(50, "Registration number is too long.")
      .default("")
      .transform((value) => (value === "" ? null : value)),
    categories: z
      .array(z.string())
      .min(1, "Choose at least one category.")
      .max(12, "Choose at most 12 categories.")
      .refine((slugs) => new Set(slugs).size === slugs.length, "Each category can be chosen once.")
      .refine(
        (slugs) => slugs.every((slug) => context.categories.includes(slug)),
        "Choose categories from the list.",
      ),
    documentPath: z
      .string()
      .refine((path) => parseVendorDocumentPath(path)?.userId === context.userId, "Upload your ID document."),
  });
}

export type VendorApplicationInput = z.output<ReturnType<typeof createVendorApplicationSchema>>;

export const vendorIdSchema = z.uuid("Invalid vendor.");

export const suspensionNoteSchema = z
  .string()
  .trim()
  .max(2000, "Note is too long.")
  .transform((value) => (value === "" ? null : value));

/**
 * Payout details are a small set of text fields (for example bank_name,
 * account_name, account_number). The exact fields are chosen by the vendor
 * form in Batch 2; the database only requires a non-empty JSON object.
 */
export const payoutDetailsSchema = z
  .record(
    z.string().regex(/^[a-z][a-z0-9_]{0,39}$/, "Invalid field name."),
    z.string().trim().min(1, "This field cannot be empty.").max(200, "Value is too long."),
  )
  .refine((details) => Object.keys(details).length >= 1, { message: "Enter your payout details." })
  .refine((details) => Object.keys(details).length <= 12, { message: "Too many fields." });

/** The token returned when a vendor requests a change. Proves the admin reviewed that exact request. */
export const payoutRequestTokenSchema = z.uuid("Invalid request.");

export const rejectionNoteSchema = z
  .string()
  .trim()
  .max(500, "Note is too long.")
  .transform((value) => (value === "" ? null : value));

export type PayoutDetails = z.infer<typeof payoutDetailsSchema>;

export const VENDOR_REVIEW_INTENTS = ["approve", "reject", "suspend"] as const;

export const vendorReviewSchema = z
  .object({
    vendorId: vendorIdSchema,
    intent: z.enum(VENDOR_REVIEW_INTENTS),
    reason: z.string().trim().max(2000, "The reason is too long.").default(""),
  })
  .superRefine((data, ctx) => {
    if (data.intent !== "approve" && data.reason.length < 5) {
      ctx.addIssue({
        code: "custom",
        path: ["reason"],
        message: "Give a reason of at least 5 characters. The vendor will see it.",
      });
    }
  });
