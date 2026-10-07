import type { SupabaseClient } from "@supabase/supabase-js";
import { Constants, type Database, type Enums } from "@/lib/supabase/database.types";

export type OrderStatus = Enums<"order_status">;

export const ORDER_STATUSES = Constants.public.Enums.order_status;

/**
 * Every allowed order status move, in one place. The database holds the same
 * map (table order_status_transitions) and refuses any other move, so this
 * file and the table must agree: tests/db compares them. The steps after
 * payment are provisional; later batches extend them together with a new
 * migration.
 */
export const ORDER_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  draft: ["quote_requested", "awaiting_payment", "cancelled"],
  quote_requested: ["quoted", "cancelled"],
  quoted: ["awaiting_payment", "quote_expired", "cancelled"],
  quote_expired: ["quote_requested", "cancelled"],
  awaiting_payment: ["paid", "cancelled"],
  paid: ["purchased", "refunded"],
  purchased: ["inspection_pending", "disputed", "refunded"],
  inspection_pending: ["inspection_approved", "disputed", "refunded"],
  inspection_approved: ["shipped", "disputed", "refunded"],
  shipped: ["in_transit", "disputed"],
  in_transit: ["arrived_destination", "disputed"],
  arrived_destination: ["customs_cleared", "disputed"],
  customs_cleared: ["out_for_delivery", "disputed"],
  out_for_delivery: ["delivered", "disputed"],
  delivered: ["disputed"],
  disputed: [
    "refunded",
    "inspection_approved",
    "shipped",
    "in_transit",
    "arrived_destination",
    "customs_cleared",
    "out_for_delivery",
    "delivered",
  ],
  cancelled: [],
  refunded: [],
};

export class InvalidTransitionError extends Error {
  constructor(
    readonly from: OrderStatus,
    readonly to: OrderStatus,
  ) {
    super(`An order cannot move from ${from} to ${to}.`);
    this.name = "InvalidTransitionError";
  }
}

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from].includes(to);
}

/** Throws InvalidTransitionError for a move that is not in the map. */
export function assertTransition(from: OrderStatus, to: OrderStatus): void {
  if (!canTransition(from, to)) throw new InvalidTransitionError(from, to);
}

/** An order that can never change status again. */
export function isFinalStatus(status: OrderStatus): boolean {
  return ORDER_TRANSITIONS[status].length === 0;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Moves an order to a new status through the database function
 * transition_order(), which checks the map, updates the order and writes
 * audit_log. All status changes in the app go through here (or through the
 * database functions that call transition_order themselves).
 *
 * Uses the service role: the caller must already have checked that `actorId`
 * may make this change. `actorId` is recorded in the audit log.
 * Rejects any move that is not in the map with an InvalidTransitionError.
 */
export async function transitionOrder(
  orderId: string,
  toStatus: OrderStatus,
  actorId: string | null,
  note?: string | null,
): Promise<{ from: OrderStatus; to: OrderStatus }> {
  // Loaded when called, so importing the map never pulls in server-only code.
  const { createServiceClient } = await import("@/lib/supabase/service");
  return transitionOrderWith(createServiceClient(), orderId, toStatus, actorId, note);
}

/** transitionOrder with the database client passed in. Used by tests. */
export async function transitionOrderWith(
  client: SupabaseClient<Database>,
  orderId: string,
  toStatus: OrderStatus,
  actorId: string | null,
  note?: string | null,
): Promise<{ from: OrderStatus; to: OrderStatus }> {
  if (!UUID_PATTERN.test(orderId)) throw new Error("Invalid order id.");
  if (!(ORDER_STATUSES as readonly string[]).includes(toStatus))
    throw new Error(`Unknown status: ${toStatus}`);
  if (actorId !== null && !UUID_PATTERN.test(actorId)) throw new Error("Invalid actor id.");
  if (note && note.length > 500) throw new Error("The note is too long.");

  const { data: order, error: readError } = await client
    .from("orders")
    .select("status")
    .eq("id", orderId)
    .maybeSingle();
  if (readError) throw new Error(`Could not read the order: ${readError.message}`);
  if (!order) throw new Error("Order not found.");

  // A clear error before asking the database. The database checks again.
  assertTransition(order.status, toStatus);

  const { error } = await client.rpc("transition_order", {
    _order_id: orderId,
    _to: toStatus,
    ...(note ? { _note: note } : {}),
    ...(actorId ? { _actor: actorId } : {}),
  });
  if (error) throw new Error(error.message);
  return { from: order.status, to: toStatus };
}
