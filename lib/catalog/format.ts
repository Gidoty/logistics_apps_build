/** Small text helpers for product pages. */

/** "10 to 21 days", "Up to 21 days", "About 10 days", or null when unknown. */
export function formatTransitDays(min: number | null, max: number | null): string | null {
  if (min === null && max === null) return null;
  if (min !== null && max !== null) {
    if (min === max) return `About ${max} ${max === 1 ? "day" : "days"}`;
    return `${min} to ${max} days`;
  }
  const only = (min ?? max) as number;
  return min === null
    ? `Up to ${only} ${only === 1 ? "day" : "days"}`
    : `At least ${only} ${only === 1 ? "day" : "days"}`;
}

export function formatWarranty(months: number): string {
  if (months <= 0) return "No warranty";
  if (months % 12 === 0) {
    const years = months / 12;
    return `${years} ${years === 1 ? "year" : "years"} warranty`;
  }
  return `${months} ${months === 1 ? "month" : "months"} warranty`;
}

export function formatStock(stock: number): string {
  if (stock <= 0) return "Out of stock";
  if (stock <= 5) return `Only ${stock} left`;
  return "In stock";
}

/** "Page 2 of 7" helpers. */
export function pageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize));
}
