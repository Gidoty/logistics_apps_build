/**
 * Everything the pricing engine and FX conversion can refuse to do. Each
 * error carries a code the app can branch on and a message that names what to
 * fix, so an admin knows which rule to add. Messages are for admins: public
 * pages show a generic text instead (see lib/pricing/public-errors.ts).
 */
export type PricingErrorCode =
  "INVALID_INPUT" | "MISSING_RULE" | "OVERLAPPING_RULES" | "FX_STALE" | "FX_MISSING";

export class PricingError extends Error {
  constructor(
    readonly code: PricingErrorCode,
    message: string,
    readonly detail: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = "PricingError";
  }
}

export function isPricingError(error: unknown): error is PricingError {
  return error instanceof PricingError;
}
