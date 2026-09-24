const MAX_SEARCH_LENGTH = 100;

/**
 * Turns an admin search box value into an ILIKE pattern, or null when empty.
 * Only letters, numbers, spaces and @ . _ % + ' - are kept. Everything else
 * is dropped, so the value cannot break out of a PostgREST filter string.
 * _ and % stay as wildcards, which is fine for an admin-only search.
 */
export function toSearchPattern(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value
    .replace(/[^\p{L}\p{N} @._%+'-]/gu, "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, MAX_SEARCH_LENGTH);
  return cleaned === "" ? null : `%${cleaned}%`;
}
