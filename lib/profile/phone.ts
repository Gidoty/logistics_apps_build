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

/**
 * Nigerian mobile numbers, stored as +234XXXXXXXXXX. Accepts 08031234567,
 * 0803 123 4567, 8031234567, 2348031234567, 002348031234567 and
 * +234 803 123 4567. Mobile prefixes only (070x, 080x, 081x, 090x, 091x):
 * delivery codes are sent by SMS, so landlines are refused.
 * Returns null when the number is not valid.
 */
export function normalizeNigerianPhone(input: string): string | null {
  const compact = input.trim().replace(/[\s().-]/g, "");
  if (!/^\+?[0-9]+$/.test(compact)) return null;

  let national = compact.startsWith("+") ? compact.slice(1) : compact;
  if (national.startsWith("00")) national = national.slice(2);
  if (national.startsWith("234")) national = national.slice(3);
  else if (national.startsWith("0")) national = national.slice(1);

  return /^[789][01][0-9]{8}$/.test(national) ? `+234${national}` : null;
}
