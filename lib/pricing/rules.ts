import { PricingError } from "./errors";
import type { CategoryNode, DeliveryZone, DutyRate, FeeRule, FeeType } from "./types";

/** The category and its parents, nearest first, then null for "any category". */
export function categoryChain(slug: string, categories: readonly CategoryNode[]): (string | null)[] {
  const chain: (string | null)[] = [];
  const seen = new Set<string>();
  let current: string | null = slug;
  while (current !== null && !seen.has(current)) {
    chain.push(current);
    seen.add(current);
    const slugNow: string = current;
    current = categories.find((node) => node.slug === slugNow)?.parentSlug ?? null;
  }
  chain.push(null);
  return chain;
}

function inWindow(rule: { effectiveFrom: string; effectiveTo: string | null }, now: Date): boolean {
  const time = now.getTime();
  return (
    new Date(rule.effectiveFrom).getTime() <= time &&
    (rule.effectiveTo === null || time < new Date(rule.effectiveTo).getTime())
  );
}

function inBand(rule: Pick<FeeRule, "weightFromG" | "weightToG">, grams: number): boolean {
  return grams >= (rule.weightFromG ?? 0) && (rule.weightToG === null || grams < rule.weightToG);
}

/**
 * The most specific candidate: category rules beat general ones, and a parent
 * category covers its children when they have no rule of their own. Two
 * candidates at the same level are an overlap, which is an error, never a guess.
 */
export function selectMostSpecific<T extends { id: string; categorySlug: string | null }>(
  candidates: readonly T[],
  chain: readonly (string | null)[],
  what: string,
): T | null {
  for (const level of chain) {
    const matches = candidates.filter((candidate) => candidate.categorySlug === level);
    if (matches.length > 1) {
      throw new PricingError(
        "OVERLAPPING_RULES",
        `More than one ${what} applies at the same time: rules ${matches.map((m) => m.id).join(", ")}. ` +
          "Close one of them in Admin > Pricing.",
        { ruleIds: matches.map((m) => m.id) },
      );
    }
    if (matches.length === 1) return matches[0];
  }
  return null;
}

export type FeeLookup = {
  corridorId: string;
  feeType: FeeType;
  now: Date;
  chain: readonly (string | null)[];
  /** Weight the band is matched against, in grams. */
  weightGrams: number;
  /** Required for last-mile rules, which belong to a zone. */
  zone?: DeliveryZone | null;
};

/**
 * Fee rules for one fee on this order. Normally at most one; payment
 * processing may have one percent rule and one flat rule at once.
 */
export function findFeeRules(rules: readonly FeeRule[], lookup: FeeLookup): FeeRule[] {
  const candidates = rules.filter(
    (rule) =>
      rule.corridorId === lookup.corridorId &&
      rule.feeType === lookup.feeType &&
      inWindow(rule, lookup.now) &&
      inBand(rule, lookup.weightGrams) &&
      (rule.zoneId ?? null) === (lookup.zone?.id ?? null),
  );
  const methods = [...new Set(candidates.map((rule) => rule.calcMethod))];
  // Different methods only coexist for payment processing; for every other fee
  // a second method at the same moment is an overlap and selectMostSpecific says so.
  const groups = lookup.feeType === "payment_processing" ? methods.map((method) => [method]) : [methods];
  const picked: FeeRule[] = [];
  for (const group of groups) {
    const rule = selectMostSpecific(
      candidates.filter((candidate) => group.includes(candidate.calcMethod)),
      lookup.chain,
      `${lookup.feeType} rule`,
    );
    if (rule) picked.push(rule);
  }
  return picked;
}

export function findDutyRate(
  rates: readonly DutyRate[],
  corridorId: string,
  now: Date,
  chain: readonly (string | null)[],
): DutyRate | null {
  const candidates = rates.filter((rate) => rate.corridorId === corridorId && inWindow(rate, now));
  return selectMostSpecific(candidates, chain, "duty rate");
}

/** The zone that contains the destination state, or null. */
export function findZone(zones: readonly DeliveryZone[], state: string): DeliveryZone | null {
  return zones.find((zone) => zone.states.includes(state)) ?? null;
}
