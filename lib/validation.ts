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
