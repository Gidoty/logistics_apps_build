import { z } from "zod";
import { countryCodeSchema, fullNameSchema } from "@/lib/auth/schemas";
import { normalizePhone } from "./phone";

export const currencyCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, "Choose a currency.");

const phoneSchema = z
  .string()
  .trim()
  .transform((value, ctx) => {
    if (value === "") return null;
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

export const profileUpdateSchema = z.object({
  fullName: fullNameSchema,
  phone: phoneSchema,
  countryCode: z
    .string()
    .trim()
    .transform((value) => (value === "" ? null : value))
    .pipe(countryCodeSchema.nullable()),
  preferredCurrency: currencyCodeSchema,
});

export type ProfileUpdateInput = z.infer<typeof profileUpdateSchema>;
