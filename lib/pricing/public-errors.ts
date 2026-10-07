import { isPricingError } from "./errors";

/**
 * Text for visitors and buyers. Admin messages name the missing rule or the
 * stale rate; the public must not see which rules exist, so they get these.
 */
export function publicPricingMessage(error: unknown): string {
  if (isPricingError(error)) {
    switch (error.code) {
      case "INVALID_INPUT":
        return error.message;
      case "FX_STALE":
      case "FX_MISSING":
        return "Exchange rates are being updated. Please try again in a little while.";
      case "MISSING_RULE":
      case "OVERLAPPING_RULES":
        return "We cannot work out a delivered price for this combination yet. Ask for a quote and we will price it for you.";
    }
  }
  return "We could not work out the price. Please try again.";
}

export const PRICE_ON_REQUEST = "Delivered price on request";
