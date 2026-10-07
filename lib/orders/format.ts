import type { OrderStatus } from "./state-machine";

export type StatusTone = "neutral" | "info" | "warn" | "good" | "bad";

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  draft: "Draft",
  quote_requested: "Waiting for quote",
  quoted: "Quote ready",
  quote_expired: "Quote expired",
  awaiting_payment: "Awaiting payment",
  paid: "Paid",
  purchased: "Purchased",
  inspection_pending: "Inspection pending",
  inspection_approved: "Inspected",
  shipped: "Shipped",
  in_transit: "In transit",
  arrived_destination: "Arrived in Nigeria",
  customs_cleared: "Customs cleared",
  out_for_delivery: "Out for delivery",
  delivered: "Delivered",
  disputed: "Disputed",
  refunded: "Refunded",
  cancelled: "Cancelled",
};

export const ORDER_STATUS_TONES: Record<OrderStatus, StatusTone> = {
  draft: "neutral",
  quote_requested: "info",
  quoted: "warn",
  quote_expired: "bad",
  awaiting_payment: "warn",
  paid: "good",
  purchased: "good",
  inspection_pending: "info",
  inspection_approved: "good",
  shipped: "info",
  in_transit: "info",
  arrived_destination: "info",
  customs_cleared: "info",
  out_for_delivery: "info",
  delivered: "good",
  disputed: "bad",
  refunded: "neutral",
  cancelled: "neutral",
};

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** A request that has waited this long for a quote is shown in red to admins. */
export const OVERDUE_AFTER_MS = 24 * HOUR;

/** "5 min ago", "3 h ago", "2 days ago". */
export function formatAge(from: string | Date, now: Date = new Date()): string {
  const elapsed = Math.max(0, now.getTime() - new Date(from).getTime());
  if (elapsed < MINUTE) return "just now";
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)} min ago`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)} h ago`;
  const days = Math.floor(elapsed / DAY);
  return `${days} ${days === 1 ? "day" : "days"} ago`;
}

export function isOverdue(from: string | Date, now: Date = new Date()): boolean {
  return now.getTime() - new Date(from).getTime() > OVERDUE_AFTER_MS;
}

/** Time left on a quote: "1 day 3 h", "2 h 05 min", "4 min 09 s". Returns null once it has run out. */
export function formatCountdown(expiresAt: string | Date, now: Date = new Date()): string | null {
  const left = new Date(expiresAt).getTime() - now.getTime();
  if (left <= 0) return null;
  const days = Math.floor(left / DAY);
  const hours = Math.floor((left % DAY) / HOUR);
  const minutes = Math.floor((left % HOUR) / MINUTE);
  const seconds = Math.floor((left % MINUTE) / 1000);
  if (days > 0) return `${days} ${days === 1 ? "day" : "days"} ${hours} h`;
  if (hours > 0) return `${hours} h ${String(minutes).padStart(2, "0")} min`;
  return `${minutes} min ${String(seconds).padStart(2, "0")} s`;
}

/** "8 Oct 2026, 14:05" in Nigerian time. A fixed zone and locale, so server and browser print the same text. */
export function formatDateTime(value: string | Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Africa/Lagos",
  }).format(new Date(value));
}
