import type { OrderStatus } from "./state-machine";

export type TimelineStep = {
  key: string;
  label: string;
  state: "done" | "current" | "upcoming" | "problem";
};

const STEPS = [
  { key: "requested", label: "Request sent" },
  { key: "quoted", label: "Quote ready" },
  { key: "accepted", label: "Quote accepted" },
  { key: "paid", label: "Paid" },
] as const;

/** How far an order has got along the four steps above. */
const PROGRESS: Partial<Record<OrderStatus, number>> = {
  quote_requested: 0,
  quoted: 1,
  quote_expired: 1,
  awaiting_payment: 2,
};

/**
 * The buyer's view of a link order before payment. Later stages (purchase,
 * shipping, delivery) get their own timeline in Batch 7. Every status from
 * "paid" on shows all four steps as done.
 */
export function buildRequestTimeline(status: OrderStatus): TimelineStep[] {
  if (status === "draft") return STEPS.map((step) => ({ ...step, state: "upcoming" }));

  // We do not record where a cancelled order stopped, so show only what is certain.
  if (status === "cancelled") {
    return [
      { key: "requested", label: "Request sent", state: "done" },
      { key: "cancelled", label: "Cancelled", state: "problem" },
    ];
  }

  const reached = PROGRESS[status] ?? STEPS.length - 1;
  const steps: TimelineStep[] = STEPS.map((step, index) => ({
    ...step,
    state: index < reached ? "done" : index === reached ? "current" : "upcoming",
  }));
  if (status === "quote_expired") steps[1] = { key: "quoted", label: "Quote expired", state: "problem" };
  // From "paid" on, nothing in this view is still pending.
  if (PROGRESS[status] === undefined) steps[reached] = { ...steps[reached], state: "done" };
  return steps;
}
