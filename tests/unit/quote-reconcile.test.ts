import { describe, expect, it } from "vitest";
import { computeMargin } from "@/lib/orders/margin";
import { reconcileLines, type CalculatedLine, type SubmittedLine } from "@/lib/orders/quote-reconcile";

const calculated: CalculatedLine[] = [
  { type: "item_price", label: "Item price", amountMinor: 8_333_333 },
  { type: "service_fee", label: "Service fee", amountMinor: 416_667 },
  { type: "fx_spread", label: "Currency conversion fee", amountMinor: 156_635 },
];
const same = (): SubmittedLine[] => [
  { calcType: "item_price", label: "Item price", amount: "83333.33", reason: "" },
  { calcType: "service_fee", label: "Service fee", amount: "4166.67", reason: "" },
  { calcType: "fx_spread", label: "Currency conversion fee", amount: "1566.35", reason: "" },
];

describe("reconcileLines", () => {
  it("passes untouched lines through with no override", () => {
    const result = reconcileLines(calculated, same(), 2);
    expect(result).toEqual({
      ok: true,
      lines: [
        { type: "item_price", label: "Item price", amount_minor: 8_333_333 },
        { type: "service_fee", label: "Service fee", amount_minor: 416_667 },
        { type: "fx_spread", label: "Currency conversion fee", amount_minor: 156_635 },
      ],
    });
  });

  it("requires a reason for an override and stores the original amount", () => {
    const edited = same();
    edited[1] = { ...edited[1], amount: "3000", reason: "" };
    const refused = reconcileLines(calculated, edited, 2);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.errors[0]).toContain("give a reason");

    edited[1].reason = "Loyal customer, fee reduced";
    const accepted = reconcileLines(calculated, edited, 2);
    expect(accepted.ok).toBe(true);
    if (accepted.ok) {
      expect(accepted.lines[1]).toEqual({
        type: "service_fee",
        label: "Service fee",
        amount_minor: 300_000,
        override: { reason: "Loyal customer, fee reduced", original_amount_minor: 416_667 },
      });
      expect(accepted.lines[0].override).toBeUndefined();
    }
  });

  it("rejects a too-short reason", () => {
    const edited = same();
    edited[1] = { ...edited[1], amount: "3000", reason: "ok" };
    expect(reconcileLines(calculated, edited, 2).ok).toBe(false);
  });

  it("keeps the engine's label even if the form sends another", () => {
    const edited = same();
    edited[0] = { ...edited[0], label: "Totally different" };
    const result = reconcileLines(calculated, edited, 2);
    expect(result.ok && result.lines[0].label).toBe("Item price");
  });

  it("does not let a calculated line be dropped or repeated", () => {
    const dropped = reconcileLines(calculated, same().slice(0, 2), 2);
    expect(dropped.ok).toBe(false);
    if (!dropped.ok) expect(dropped.errors.join(" ")).toContain("Currency conversion fee is missing");
    const repeated = reconcileLines(calculated, [...same(), same()[0]], 2);
    expect(repeated.ok).toBe(false);
  });

  it("rejects a line that was not in the calculation", () => {
    const bogus = same();
    bogus[0] = { ...bogus[0], calcType: "vat" };
    expect(reconcileLines(calculated, bogus, 2).ok).toBe(false);
  });

  it("accepts a manual line only with a label, an amount and a reason, and stores no original", () => {
    const withManual: SubmittedLine[] = [
      ...same(),
      { calcType: null, label: "Extra packaging", amount: "250", reason: "Customer asked for double boxing" },
    ];
    const result = reconcileLines(calculated, withManual, 2);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.lines[3]).toEqual({
        type: "other",
        label: "Extra packaging",
        amount_minor: 25_000,
        override: { reason: "Customer asked for double boxing", original_amount_minor: null },
      });
    }
    for (const bad of [
      { calcType: null, label: "", amount: "250", reason: "Customer asked" },
      { calcType: null, label: "Extra", amount: "0", reason: "Customer asked" },
      { calcType: null, label: "Extra", amount: "250", reason: "" },
    ] as SubmittedLine[]) {
      expect(reconcileLines(calculated, [...same(), bad], 2).ok).toBe(false);
    }
  });

  it("refuses amounts with too many decimals", () => {
    const edited = same();
    edited[0] = { ...edited[0], amount: "83333.333" };
    expect(reconcileLines(calculated, edited, 2).ok).toBe(false);
  });
});

describe("computeMargin", () => {
  it("is the service fee plus the conversion fee when nothing was changed", () => {
    const margin = computeMargin([
      { type: "item_price", amountMinor: 1000, override: null },
      { type: "service_fee", amountMinor: 416_667, override: null },
      { type: "fx_spread", amountMinor: 156_635, override: null },
      { type: "payment_processing", amountMinor: 213_387, override: null },
    ]);
    expect(margin).toEqual({
      serviceFeeMinor: 416_667,
      fxSpreadMinor: 156_635,
      overrideUpliftMinor: 0,
      revenueMinor: 573_302,
    });
  });

  it("counts a raised fee once: calculated amount in the fee, the rise as uplift", () => {
    const margin = computeMargin([
      { type: "service_fee", amountMinor: 500_000, override: { originalAmountMinor: 416_667 } },
    ]);
    expect(margin).toMatchObject({
      serviceFeeMinor: 416_667,
      overrideUpliftMinor: 83_333,
      revenueMinor: 500_000,
    });
  });

  it("shows a discount as negative uplift", () => {
    const margin = computeMargin([
      { type: "service_fee", amountMinor: 300_000, override: { originalAmountMinor: 416_667 } },
    ]);
    expect(margin.overrideUpliftMinor).toBe(-116_667);
    expect(margin.revenueMinor).toBe(300_000);
  });

  it("counts a manual line as pure uplift, and a changed freight line as uplift only", () => {
    const margin = computeMargin([
      { type: "service_fee", amountMinor: 100, override: null },
      { type: "international_freight", amountMinor: 3000, override: { originalAmountMinor: 2000 } },
      { type: "other", amountMinor: 250, override: { originalAmountMinor: null } },
    ]);
    expect(margin).toEqual({
      serviceFeeMinor: 100,
      fxSpreadMinor: 0,
      overrideUpliftMinor: 1250,
      revenueMinor: 1350,
    });
  });
});
