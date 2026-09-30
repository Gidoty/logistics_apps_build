import { z } from "zod";
import { countryCodeSchema } from "@/lib/auth/schemas";

export const vendorApplicationSchema = z.object({
  businessName: z.string().trim().min(2, "Enter your business name.").max(120, "Business name is too long."),
  countryCode: countryCodeSchema,
  city: z.string().trim().min(1, "Enter your city.").max(80, "City name is too long."),
});

export const vendorIdSchema = z.uuid("Invalid vendor.");

export const suspensionNoteSchema = z
  .string()
  .trim()
  .max(2000, "Note is too long.")
  .transform((value) => (value === "" ? null : value));

export type VendorApplicationInput = z.infer<typeof vendorApplicationSchema>;

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
