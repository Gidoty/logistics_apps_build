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

const FULFILMENT_STEPS = [
  { key: "paid", label: "Paid", status: "paid" },
  { key: "purchased", label: "Purchased", status: "purchased" },
  { key: "inspected", label: "Inspected", status: "inspection_approved" },
  { key: "shipped", label: "Shipped", status: "shipped" },
  { key: "in_transit", label: "In transit", status: "in_transit" },
  { key: "arrived", label: "Arrived in Nigeria", status: "arrived_destination" },
  { key: "customs", label: "Customs cleared", status: "customs_cleared" },
  { key: "out_for_delivery", label: "Out for delivery", status: "out_for_delivery" },
  { key: "delivered", label: "Delivered", status: "delivered" },
] as const satisfies readonly { key: string; label: string; status: OrderStatus }[];

/** The statuses from "paid" on, in order. `inspection_pending` counts as being between purchased and inspected. */
const FULFILMENT_RANK: Partial<Record<OrderStatus, number>> = {
  paid: 0,
  purchased: 1,
  inspection_pending: 1,
  inspection_approved: 2,
  shipped: 3,
  in_transit: 4,
  arrived_destination: 5,
  customs_cleared: 6,
  out_for_delivery: 7,
  delivered: 8,
};

/**
 * The steps after payment, shared by the buyer's order page and the public
 * tracking page. A disputed or refunded order shows one problem step: we do
 * not record how far it got, so we show only what is certain.
 */
export function buildFulfilmentTimeline(status: OrderStatus): TimelineStep[] {
  const rank = FULFILMENT_RANK[status];
  if (rank === undefined) {
    const label = status === "refunded" ? "Refunded" : status === "disputed" ? "Under review" : null;
    if (!label)
      return FULFILMENT_STEPS.map((step) => ({ key: step.key, label: step.label, state: "upcoming" }));
    return [
      { key: "paid", label: "Paid", state: "done" },
      { key: status, label, state: "problem" },
    ];
  }
  return FULFILMENT_STEPS.map((step, index) => ({
    key: step.key,
    label: step.label,
    // The final step is done once reached; earlier steps are done once passed.
    state:
      index < rank || (index === rank && status === "delivered")
        ? "done"
        : index === rank
          ? "current"
          : "upcoming",
  }));
}
