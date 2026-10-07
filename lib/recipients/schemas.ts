import { z } from "zod";
import { normalizeNigerianPhone } from "@/lib/profile/phone";

export type RecipientInput = {
  fullName: string;
  phone: string;
  email: string | null;
  addressLine: string;
  city: string;
  state: string;
  landmark: string | null;
};

export const RECIPIENT_FIELDS = [
  "fullName",
  "phone",
  "email",
  "addressLine",
  "city",
  "state",
  "landmark",
] as const;

/** Reads the recipient fields from a form. The inline form on the link page uses a prefix. */
export function readRecipientFields(formData: FormData, prefix = ""): Record<string, string> {
  return Object.fromEntries(
    RECIPIENT_FIELDS.map((name) => {
      const value = formData.get(`${prefix}${name}`);
      return [name, typeof value === "string" ? value : ""];
    }),
  );
}

/**
 * A recipient in Nigeria. The phone must be a mobile number because the
 * delivery code is sent by SMS. `states` comes from the regions table.
 */
export function createRecipientSchema(states: readonly string[]) {
  return z
    .object({
      fullName: z
        .string()
        .trim()
        .min(2, "Enter the recipient's full name.")
        .max(120, "That name is too long."),
      phone: z.string().trim().min(1, "Enter the recipient's phone number."),
      email: z.string().trim().max(254, "That email is too long.").default(""),
      addressLine: z
        .string()
        .trim()
        .min(3, "Enter the street address.")
        .max(300, "Keep the address under 300 characters."),
      city: z.string().trim().min(1, "Enter the city or town.").max(80, "That is too long."),
      state: z.string().trim(),
      landmark: z.string().trim().max(200, "Keep the landmark under 200 characters.").default(""),
    })
    .transform((data, ctx): RecipientInput => {
      const phone = normalizeNigerianPhone(data.phone);
      if (!phone) {
        ctx.addIssue({
          code: "custom",
          path: ["phone"],
          message: "Enter a Nigerian mobile number, for example 0803 123 4567.",
        });
      }
      if (data.email !== "" && !z.email().safeParse(data.email).success) {
        ctx.addIssue({ code: "custom", path: ["email"], message: "Enter a valid email or leave it empty." });
      }
      if (!states.includes(data.state)) {
        ctx.addIssue({ code: "custom", path: ["state"], message: "Choose a state from the list." });
      }
      if (!phone) return z.NEVER;
      return {
        fullName: data.fullName,
        phone,
        email: data.email === "" ? null : data.email,
        addressLine: data.addressLine,
        city: data.city,
        state: data.state,
        landmark: data.landmark === "" ? null : data.landmark,
      };
    });
}
