import { describe, expect, it } from "vitest";
import { formatStock, formatTransitDays, formatWarranty, pageCount } from "@/lib/catalog/format";

describe("formatTransitDays", () => {
  it.each([
    [10, 21, "10 to 21 days"],
    [1, 3, "1 to 3 days"],
    [5, 5, "About 5 days"],
    [1, 1, "About 1 day"],
    [null, 14, "Up to 14 days"],
    [7, null, "At least 7 days"],
    [null, null, null],
  ])("%s to %s is %s", (min, max, expected) => {
    expect(formatTransitDays(min, max)).toBe(expected);
  });
});

describe("formatWarranty", () => {
  it.each([
    [0, "No warranty"],
    [1, "1 month warranty"],
    [6, "6 months warranty"],
    [12, "1 year warranty"],
    [24, "2 years warranty"],
    [18, "18 months warranty"],
  ])("%d months is %s", (months, expected) => {
    expect(formatWarranty(months)).toBe(expected);
  });
});

describe("formatStock and pageCount", () => {
  it("describes stock levels", () => {
    expect(formatStock(0)).toBe("Out of stock");
    expect(formatStock(3)).toBe("Only 3 left");
    expect(formatStock(50)).toBe("In stock");
  });

  it("counts pages, with at least one", () => {
    expect(pageCount(0, 20)).toBe(1);
    expect(pageCount(20, 20)).toBe(1);
    expect(pageCount(21, 20)).toBe(2);
  });
});
