import { describe, expect, it } from "vitest";
import {
  formatAge,
  formatCountdown,
  isOverdue,
  ORDER_STATUS_LABELS,
  ORDER_STATUS_TONES,
} from "@/lib/orders/format";
import { ORDER_STATUSES } from "@/lib/orders/state-machine";
import { buildRequestTimeline } from "@/lib/orders/timeline";

const NOW = new Date("2026-10-08T12:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const MIN = 60_000;
const HOUR = 60 * MIN;

describe("status labels", () => {
  it("cover every status", () => {
    for (const status of ORDER_STATUSES) {
      expect(ORDER_STATUS_LABELS[status]).toBeTruthy();
      expect(ORDER_STATUS_TONES[status]).toBeTruthy();
    }
  });
});

describe("formatAge and isOverdue", () => {
  it("formats ages", () => {
    expect(formatAge(ago(10_000), NOW)).toBe("just now");
    expect(formatAge(ago(5 * MIN), NOW)).toBe("5 min ago");
    expect(formatAge(ago(3 * HOUR), NOW)).toBe("3 h ago");
    expect(formatAge(ago(24 * HOUR), NOW)).toBe("1 day ago");
    expect(formatAge(ago(50 * HOUR), NOW)).toBe("2 days ago");
    expect(formatAge(new Date(NOW.getTime() + HOUR), NOW)).toBe("just now");
  });
  it("marks requests older than 24 hours as overdue", () => {
    expect(isOverdue(ago(23 * HOUR), NOW)).toBe(false);
    expect(isOverdue(ago(24 * HOUR), NOW)).toBe(false);
    expect(isOverdue(ago(24 * HOUR + 1), NOW)).toBe(true);
  });
});

describe("formatCountdown", () => {
  const at = (ms: number) => new Date(NOW.getTime() + ms);
  it("formats the time left", () => {
    expect(formatCountdown(at(27 * HOUR), NOW)).toBe("1 day 3 h");
    expect(formatCountdown(at(48 * HOUR), NOW)).toBe("2 days 0 h");
    expect(formatCountdown(at(2 * HOUR + 5 * MIN), NOW)).toBe("2 h 05 min");
    expect(formatCountdown(at(4 * MIN + 9000), NOW)).toBe("4 min 09 s");
  });
  it("returns null once the time has run out", () => {
    expect(formatCountdown(at(0), NOW)).toBeNull();
    expect(formatCountdown(at(-1000), NOW)).toBeNull();
  });
});

describe("buildRequestTimeline", () => {
  const states = (status: Parameters<typeof buildRequestTimeline>[0]) =>
    buildRequestTimeline(status).map((step) => step.state);

  it("follows the order", () => {
    expect(states("quote_requested")).toEqual(["current", "upcoming", "upcoming", "upcoming"]);
    expect(states("quoted")).toEqual(["done", "current", "upcoming", "upcoming"]);
    expect(states("awaiting_payment")).toEqual(["done", "done", "current", "upcoming"]);
    expect(states("paid")).toEqual(["done", "done", "done", "done"]);
    expect(states("delivered")).toEqual(["done", "done", "done", "done"]);
  });
  it("shows an expired quote as a problem", () => {
    const steps = buildRequestTimeline("quote_expired");
    expect(steps[1]).toMatchObject({ label: "Quote expired", state: "problem" });
  });
  it("shows only what is certain for a cancelled order", () => {
    expect(buildRequestTimeline("cancelled").map((step) => step.state)).toEqual(["done", "problem"]);
  });
});
