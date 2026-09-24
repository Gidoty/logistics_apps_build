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
