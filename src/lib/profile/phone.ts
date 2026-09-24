/**
 * Normalizes a phone number typed in international format to E.164,
 * for example "+44 7700 900-123" becomes "+447700900123".
 * Returns null when the input is not a valid international number.
 * Local formats such as "0803 123 4567" are rejected: we cannot tell the
 * country for sure, and SMS delivery codes depend on the number being right.
 */
export function normalizePhone(input: string): string | null {
  const trimmed = input.trim();
  const withPlus = trimmed.startsWith("00") ? `+${trimmed.slice(2)}` : trimmed;
  if (!withPlus.startsWith("+")) return null;

  const digits = withPlus.slice(1).replace(/[\s().-]/g, "");
  if (!/^[1-9][0-9]{6,14}$/.test(digits)) return null;

  return `+${digits}`;
}
