import { describe, expect, it } from "vitest";

import { buildFulfilmentTimeline } from "@/lib/orders/timeline";

describe("buildFulfilmentTimeline", () => {
  const states = (status: Parameters<typeof buildFulfilmentTimeline>[0]) =>
    buildFulfilmentTimeline(status).map((step) => step.state);

  it("has the nine steps from the brief", () => {
    expect(buildFulfilmentTimeline("paid").map((s) => s.label)).toEqual([
      "Paid",
      "Purchased",
      "Inspected",
      "Shipped",
      "In transit",
      "Arrived in Nigeria",
      "Customs cleared",
      "Out for delivery",
      "Delivered",
    ]);
  });
  it("marks passed steps done and the present one current", () => {
    expect(states("paid")).toEqual(["current", ...Array(8).fill("upcoming")]);
    expect(states("inspection_pending")).toEqual(["done", "current", ...Array(7).fill("upcoming")]);
    expect(states("in_transit").slice(0, 6)).toEqual(["done", "done", "done", "done", "current", "upcoming"]);
  });
  it("marks every step done once delivered", () => {
    expect(states("delivered")).toEqual(Array(9).fill("done"));
  });
  it("shows one problem step for a disputed or refunded order", () => {
    expect(buildFulfilmentTimeline("disputed").map((s) => s.state)).toEqual(["done", "problem"]);
    expect(buildFulfilmentTimeline("refunded")[1].label).toBe("Refunded");
  });
});
