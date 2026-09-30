/**
 * Prohibited-terms check for product listings.
 *
 * A match never rejects the listing outright: the product is saved inactive
 * and flagged for admin review. The database trigger products_guard_write
 * applies the same check with the prohibited_terms table, so a vendor cannot
 * skip it by calling Supabase directly. This list gives vendors instant
 * feedback in the form. tests/db compares the two lists and their behavior.
 *
 * Limits: whole words and phrases only, case-insensitive. Spelling tricks
 * such as "w e a p o n" are not caught. Some harmless listings will match
 * ("fake plants"); an admin clears those.
 */
export const PROHIBITED_TERMS = [
  // weapons
  "firearm",
  "firearms",
  "rifle",
  "pistol",
  "handgun",
  "revolver",
  "shotgun",
  "ammunition",
  "taser",
  "stun gun",
  "pepper spray",
  "switchblade",
  "grenade",
  "detonator",
  // hazardous
  "explosive",
  "explosives",
  "gunpowder",
  "fireworks",
  "asbestos",
  "radioactive",
  "uranium",
  "cyanide",
  "pesticide",
  // drugs
  "cocaine",
  "heroin",
  "cannabis",
  "marijuana",
  "methamphetamine",
  "meth",
  "mdma",
  "lsd",
  "tramadol",
  "codeine",
  "opioid",
  // counterfeit
  "counterfeit",
  "fake",
  "replica",
  "knockoff",
  "knock-off",
  "clone",
  "first copy",
  "super copy",
  "master copy",
  "aaa grade",
  "mirror quality",
] as const;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Same idea as Postgres \m and \M: the term must not touch a letter, number or underscore.
const PATTERNS = PROHIBITED_TERMS.map((term) => ({
  term,
  pattern: new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegExp(term)}(?![\\p{L}\\p{N}_])`, "u"),
}));

export type ProductText = {
  title: string;
  description: string;
  brand?: string | null;
  conditionNotes?: string | null;
  specs?: Record<string, string>;
};

/** The text that is scanned: the same fields the database trigger reads. */
export function productTextToScan(product: ProductText): string {
  return [
    product.title,
    product.description,
    product.brand,
    product.conditionNotes,
    ...Object.values(product.specs ?? {}),
  ]
    .filter((part): part is string => typeof part === "string" && part !== "")
    .join(" ");
}

/** Prohibited terms found in `text`, sorted and without repeats. */
export function findProhibitedTerms(text: string): string[] {
  const lower = text.toLowerCase();
  return PATTERNS.filter(({ pattern }) => pattern.test(lower))
    .map(({ term }) => term as string)
    .sort();
}

export function scanProduct(product: ProductText): string[] {
  return findProhibitedTerms(productTextToScan(product));
}

/** Short text for the vendor when a listing is held for review. */
export function describeHold(terms: string[]): string {
  return `It contains words we review before publishing (${terms.join(", ")}). An admin will check it, usually within one business day.`;
}
