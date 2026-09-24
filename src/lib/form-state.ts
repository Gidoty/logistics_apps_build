import type { z } from "zod";

/** Result returned by Server Actions that back forms. */
export type FormState = {
  status: "idle" | "success" | "error";
  message?: string;
  fieldErrors?: Record<string, string[]>;
};

export const initialFormState: FormState = { status: "idle" };

export function formError(message: string): FormState {
  return { status: "error", message };
}

export function formSuccess(message: string): FormState {
  return { status: "success", message };
}

export function fromZodError(error: z.ZodError): FormState {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "form";
    (fieldErrors[key] ??= []).push(issue.message);
  }
  return { status: "error", message: "Please fix the highlighted fields.", fieldErrors };
}

/** Reads a text field from FormData. Missing or file values become "". */
export function readText(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}
