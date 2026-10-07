import { describe, expect, it } from "vitest";
import { calculateLandedCost } from "@/lib/pricing/engine";
import { chinaInput, fxRows, nigeriaInput, rules } from "./pricing-fixtures";

const summary = (result: ReturnType<typeof calculateLandedCost>) =>
  result.lines.map((line) => [line.type, line.amountMinor]);

describe("golden: China to Nigeria", () => {
  /**
   * Input: 2 phones at CNY 200.00 (20000 minor each), 1500 g, box 30x20x10 cm,
   * to Lagos (Zone A), buyer pays in NGN. Rates: 1 USD = 1500 NGN = 7.2 CNY.
   * Conversion fee for NGN buyers: 1.5%.
   *
   * Item subtotal      CNY 40000 minor
   *   to NGN           40000 x 1500 / 7.2 = 8,333,333.33  -> 8,333,333 kobo
   * Chargeable weight  volumetric 30x20x10/5 = 1200 g; actual 1500 g wins -> 1500 g
   * Freight            900 cents/kg x 1500 g / 1000 = 1350 cents (min 900)   USD 13.50
   *   to NGN           1350 x 1500 = 2,025,000 kobo
   * Insurance          1% of item in USD: 40000/7.2 = 5555.56 -> 5556 cents; 1% = 55.56 -> 56 cents
   *   to NGN           56 x 1500 = 84,000 kobo
   * Customs value CIF  8,333,333 + 2,025,000 + 84,000 = 10,442,333 kobo
   * Import duty 5%     522,116.65  -> 522,117      (phones rate beats electronics and general)
   * Other levies 4%    417,693.32  -> 417,693
   * VAT 7.5%           (10,442,333 + 522,117 + 417,693) = 11,382,143 x 7.5% = 853,660.725 -> 853,661
   * Clearing           500,000
   * Last mile          Lagos is Zone A, 1500 g band 0-5000: 250,000
   * Service fee        5% of 8,333,333 = 416,666.65 -> 416,667 (min 200,000 not needed)
   * Conversion fee     1.5% of each converted line:
   *                    8,333,333 -> 124,999.995 -> 125,000
   *                    2,025,000 -> 30,375
   *                       84,000 -> 1,260            total 156,635
   * Other lines + fee  8,333,333 + 2,025,000 + 84,000 + 522,117 + 417,693 + 853,661
   *                    + 500,000 + 250,000 + 416,667 + 156,635 = 13,559,106
   * Payment processing 1.5% x 13,559,106 = 203,386.59 -> 203,387, plus flat 10,000 = 213,387
   * Total              13,559,106 + 213,387 = 13,772,493 kobo = NGN 137,724.93
   */
  it("matches the worked example to the minor unit", () => {
    const result = calculateLandedCost(chinaInput(), rules(), fxRows());

    expect(summary(result)).toEqual([
      ["item_price", 8_333_333],
      ["international_freight", 2_025_000],
      ["insurance", 84_000],
      ["import_duty", 522_117],
      ["other_levies", 417_693],
      ["vat", 853_661],
      ["clearing", 500_000],
      ["last_mile_delivery", 250_000],
      ["service_fee", 416_667],
      ["payment_processing", 213_387],
      ["fx_spread", 156_635],
    ]);
    expect(result.total).toBe(13_772_493);
    expect(result.currency).toBe("NGN");
    expect(result.chargeableWeightGrams).toBe(1500);
    expect(result.weightBasis).toBe("actual");
    expect(result.warnings).toEqual([]);
  });

  it("labels the customs lines Estimated and carries the disclaimer", () => {
    const result = calculateLandedCost(chinaInput(), rules(), fxRows());
    const customs = result.lines.filter((line) => ["import_duty", "other_levies", "vat"].includes(line.type));
    expect(customs).toHaveLength(3);
    for (const line of customs) {
      expect(line.estimated).toBe(true);
      expect(line.label).toContain("Estimated");
    }
    expect(result.customsDisclaimer).toBe(
      "Customs charges are estimates. Final duty is set by Nigeria Customs Service.",
    );
    expect(result.lines.find((line) => line.type === "fx_spread")?.label).toBe("Currency conversion fee");
  });
});

describe("golden: Nigeria to Nigeria", () => {
  /**
   * Input: 1 item at NGN 150,000.00 (15,000,000 kobo), 800 g, special handling,
   * to Anambra (Zone B), buyer pays in GBP. Rates: 1 USD = 1500 NGN = 0.8 GBP,
   * so 1 kobo = 0.8/1500 pence. Conversion fee for GBP buyers: 2%.
   * No freight, no insurance, no duty, no clearing.
   *
   * Item               15,000,000 x 0.8 / 1500 = 8,000 pence
   * Service fee        5% = 750,000 kobo -> 400 pence
   * Last mile          Zone B, 800 g band 0-5000: 350,000 kobo -> 186.67 -> 187 pence
   * Special handling   300,000 kobo -> 160 pence
   * Conversion fee     2% of 8,000 = 160; of 400 = 8; of 187 = 3.74 -> 4; of 160 = 3.2 -> 3   total 175
   * Other lines + fee  8,000 + 400 + 187 + 160 + 175 = 8,922
   * Payment processing 1.5% x 8,922 = 133.83 -> 134; flat 10,000 kobo = 5.33 -> 5; total 139
   * Total              8,922 + 139 = 9,061 pence = GBP 90.61
   */
  it("matches the worked example with no freight or duty", () => {
    const result = calculateLandedCost(nigeriaInput(), rules(), fxRows());

    expect(summary(result)).toEqual([
      ["item_price", 8000],
      ["special_handling", 160],
      ["last_mile_delivery", 187],
      ["service_fee", 400],
      ["payment_processing", 139],
      ["fx_spread", 175],
    ]);
    expect(result.total).toBe(9061);
    expect(result.currency).toBe("GBP");
    expect(result.customsDisclaimer).toBeNull();
    expect(
      result.lines.some((line) =>
        ["international_freight", "import_duty", "vat", "clearing"].includes(line.type),
      ),
    ).toBe(false);
  });

  it("has no conversion fee when the buyer pays in the item currency", () => {
    const result = calculateLandedCost(nigeriaInput({ buyerCurrency: "NGN" }), rules(), fxRows());
    expect(result.lines.some((line) => line.type === "fx_spread")).toBe(false);
    // 15,000,000 + 750,000 + 350,000 + 300,000 = 16,400,000; 1.5% = 246,000; + 10,000 flat
    expect(result.total).toBe(16_400_000 + 246_000 + 10_000);
  });
});
