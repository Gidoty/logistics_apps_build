import { describe, expect, it } from "vitest";
import {
  assertTransition,
  canTransition,
  InvalidTransitionError,
  isFinalStatus,
  ORDER_STATUSES,
  ORDER_TRANSITIONS,
  transitionOrderWith,
  type OrderStatus,
} from "@/lib/orders/state-machine";

const ALLOWED = Object.entries(ORDER_TRANSITIONS).flatMap(([from, tos]) =>
  tos.map((to) => [from, to] as [OrderStatus, OrderStatus]),
);

describe("order state machine", () => {
  it("has 42 allowed moves over 18 statuses", () => {
    expect(ORDER_STATUSES).toHaveLength(18);
    expect(ALLOWED).toHaveLength(42);
  });

  it.each(ALLOWED)("allows %s -> %s", (from, to) => {
    expect(canTransition(from, to)).toBe(true);
    expect(() => assertTransition(from, to)).not.toThrow();
  });

  it.each([
    ["draft", "paid"],
    ["quote_requested", "awaiting_payment"],
    ["quoted", "paid"],
    ["awaiting_payment", "quoted"],
    ["paid", "delivered"],
    ["delivered", "paid"],
    ["cancelled", "quote_requested"],
    ["refunded", "paid"],
    ["shipped", "paid"],
    ["quote_expired", "awaiting_payment"],
    ["draft", "draft"],
    ["quoted", "quoted"],
  ] as [OrderStatus, OrderStatus][])("refuses %s -> %s", (from, to) => {
    expect(canTransition(from, to)).toBe(false);
    expect(() => assertTransition(from, to)).toThrow(InvalidTransitionError);
  });

  it("checks every pair: 42 allowed, 282 refused", () => {
    let refused = 0;
    for (const from of ORDER_STATUSES)
      for (const to of ORDER_STATUSES) if (!canTransition(from, to)) refused++;
    expect(refused).toBe(18 * 18 - 42);
  });

  it("treats cancelled and refunded as final", () => {
    expect(isFinalStatus("cancelled")).toBe(true);
    expect(isFinalStatus("refunded")).toBe(true);
    expect(isFinalStatus("quoted")).toBe(false);
  });
});

const ORDER_ID = "11111111-1111-4111-8111-111111111111";
const ACTOR_ID = "22222222-2222-4222-8222-222222222222";

function fakeClient(status: OrderStatus | null) {
  const calls: { fn: string; args: unknown }[] = [];
  const client = {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: status ? { status } : null, error: null }),
        }),
      }),
    }),
    rpc: async (fn: string, args: unknown) => {
      calls.push({ fn, args });
      return { error: null };
    },
  };
  // The fake only has the calls transitionOrderWith makes.
  return { client: client as never, calls };
}

describe("transitionOrderWith", () => {
  it("calls transition_order for an allowed move", async () => {
    const { client, calls } = fakeClient("quote_requested");
    const result = await transitionOrderWith(client, ORDER_ID, "quoted", ACTOR_ID, "hi");
    expect(result).toEqual({ from: "quote_requested", to: "quoted" });
    expect(calls).toEqual([
      { fn: "transition_order", args: { _order_id: ORDER_ID, _to: "quoted", _note: "hi", _actor: ACTOR_ID } },
    ]);
  });

  it("refuses a forbidden move without calling the database function", async () => {
    const { client, calls } = fakeClient("quote_requested");
    await expect(transitionOrderWith(client, ORDER_ID, "paid", ACTOR_ID)).rejects.toThrow(
      InvalidTransitionError,
    );
    expect(calls).toHaveLength(0);
  });

  it("rejects a missing order, bad ids and a long note", async () => {
    await expect(transitionOrderWith(fakeClient(null).client, ORDER_ID, "quoted", null)).rejects.toThrow(
      /not found/,
    );
    const { client } = fakeClient("draft");
    await expect(transitionOrderWith(client, "nope", "quoted", null)).rejects.toThrow(/Invalid order/);
    await expect(transitionOrderWith(client, ORDER_ID, "quoted", "nope")).rejects.toThrow(/Invalid actor/);
    await expect(transitionOrderWith(client, ORDER_ID, "quoted", null, "x".repeat(501))).rejects.toThrow(
      /too long/,
    );
    await expect(transitionOrderWith(client, ORDER_ID, "bogus" as never, null)).rejects.toThrow(/Unknown/);
  });
});
