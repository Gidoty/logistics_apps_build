import { z } from "zod";

/** A whole number typed as text or given as a number, within [min, max]. */
export function wholeNumber(label: string, min: number, max: number) {
  return z.union([z.string(), z.number()]).transform((value, ctx) => {
    const text = String(value).trim();
    if (!/^\d{1,9}$/.test(text)) {
      ctx.addIssue({ code: "custom", message: `${label} must be a whole number.` });
      return z.NEVER;
    }
    const number = Number(text);
    if (number < min || number > max) {
      ctx.addIssue({ code: "custom", message: `${label} must be between ${min} and ${max}.` });
      return z.NEVER;
    }
    return number;
  });
}

/** Field errors keyed by field name, for forms. */
export function fieldErrorsFromIssues(issues: readonly z.core.$ZodIssue[]): Record<string, string[]> {
  const errors: Record<string, string[]> = {};
  for (const issue of issues) {
    const key = String(issue.path[0] ?? "form");
    (errors[key] ??= []).push(issue.message);
  }
  return errors;
}

export const MAX_DIMENSION_CM = 1000;

/** A box side in cm typed as text: empty means "not given", otherwise above 0 with up to 2 decimals. */
export function optionalDimensionCm(label: string) {
  return z
    .string()
    .default("")
    .transform((value, ctx) => {
      const text = value.trim();
      if (text === "") return null;
      if (!/^\d{1,4}(\.\d{1,2})?$/.test(text) || Number(text) <= 0 || Number(text) > MAX_DIMENSION_CM) {
        ctx.addIssue({
          code: "custom",
          message: `${label} must be a number above 0 and up to ${MAX_DIMENSION_CM} cm, with at most 2 decimals.`,
        });
        return z.NEVER;
      }
      return Number(text);
    });
}
