import { describe, expect, it } from "vitest";
import { calculateLandedCost } from "@/lib/pricing/engine";
import { PricingError } from "@/lib/pricing/errors";
import { replaySnapshot, snapshotReproduces } from "@/lib/pricing/snapshot";
import type { FeeRule, PricingInput } from "@/lib/pricing/types";
import {
  CN_NG,
  NG_NG,
  NOW,
  ZONES,
  chinaInput,
  dutyRates,
  fee,
  feeRules,
  fxRows,
  nigeriaInput,
  rules,
} from "./pricing-fixtures";

function fails(run: () => unknown): PricingError {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(PricingError);
    return error as PricingError;
  }
  throw new Error("expected a PricingError");
}

describe("lines always add up to the total", () => {
  // A small seeded generator so a failure can be reproduced.
  function random(seed: number) {
    return () => {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  it("holds for 200 random inputs, in every currency", () => {
    const next = random(20261015);
    const int = (min: number, max: number) => min + Math.floor(next() * (max - min + 1));
    const pick = <T>(items: readonly T[]): T => items[int(0, items.length - 1)];
    const states = ZONES.flatMap((zone) => zone.states);

    for (let i = 0; i < 200; i++) {
      const input: PricingInput = {
        now: NOW,
        itemUnitPriceMinor: int(1, 900_000_000),
        itemCurrency: pick(["NGN", "USD", "GBP", "CNY"]),
        quantity: int(1, 7),
        actualWeightGrams: int(1, 99_999),
        dimensionsCm: next() < 0.5 ? null : { length: int(1, 70), width: int(1, 70), height: int(1, 70) },
        categorySlug: pick(["phones", "laptops", "electronics", "general"]),
        corridor: pick([CN_NG, NG_NG]),
        destinationState: pick(states),
        buyerCurrency: pick(["NGN", "USD", "GBP", "CNY"]),
        specialHandling: next() < 0.4,
      };
      const result = calculateLandedCost(input, rules(), fxRows());
      const sum = result.lines.reduce((total, line) => total + line.amountMinor, 0);
      expect(sum, JSON.stringify(input)).toBe(result.total);
      expect(Number.isInteger(result.total) && result.total > 0).toBe(true);
      for (const line of result.lines) {
        expect(Number.isInteger(line.amountMinor) && line.amountMinor >= 0).toBe(true);
      }
      expect(result.snapshot.output.total).toBe(result.total);
    }
  });
});

describe("chargeable weight", () => {
  it("uses volumetric weight for a large, light box", () => {
    // 60 x 50 x 40 cm = 120,000 cm3 / 5000 = 24 kg = 24,000 g, against 1,000 g actual.
    const result = calculateLandedCost(
      chinaInput({ actualWeightGrams: 1000, dimensionsCm: { length: 60, width: 50, height: 40 } }),
      rules(),
      fxRows(),
    );
    expect(result.chargeableWeightGrams).toBe(24_000);
    expect(result.weightBasis).toBe("volumetric");
    // 24,000 g is in the 20,000 to 100,000 band at 650 cents per kg: 24 x 650 = 15,600 cents
    const freight = result.lines.find((line) => line.type === "international_freight")!;
    expect(freight.ruleId).toBe("cn-freight-3");
    expect(freight.nativeAmountMinor).toBe(15_600);
  });

  it("uses actual weight for a small, heavy item", () => {
    // 10 x 10 x 10 cm = 1,000 cm3 / 5000 = 0.2 kg = 200 g, against 3,000 g actual.
    const result = calculateLandedCost(
      chinaInput({ actualWeightGrams: 3000, dimensionsCm: { length: 10, width: 10, height: 10 } }),
      rules(),
      fxRows(),
    );
    expect(result.chargeableWeightGrams).toBe(3000);
    expect(result.weightBasis).toBe("actual");
  });

  it("adds a warning, and skips volumetric weight, when there are no dimensions", () => {
    const result = calculateLandedCost(chinaInput({ dimensionsCm: null }), rules(), fxRows());
    expect(result.warnings.map((w) => w.code)).toEqual(["VOLUMETRIC_SKIPPED"]);
    expect(result.chargeableWeightGrams).toBe(1500);
  });

  it("rounds volumetric grams half up", () => {
    // 10.5 x 10 x 10 = 1,050 cm3 / 5 = 210 g exactly; 10.01 x 10 x 10 = 1,001 / 5 = 200.2 -> 200
    const a = calculateLandedCost(
      chinaInput({ actualWeightGrams: 100, dimensionsCm: { length: 10.5, width: 10, height: 10 } }),
      rules(),
      fxRows(),
    );
    expect(a.chargeableWeightGrams).toBe(210);
    const b = calculateLandedCost(
      chinaInput({ actualWeightGrams: 100, dimensionsCm: { length: 10.01, width: 10, height: 10 } }),
      rules(),
      fxRows(),
    );
    expect(b.chargeableWeightGrams).toBe(200);
  });
});

describe("weight band boundaries (a band is from-inclusive, to-exclusive)", () => {
  const freightRule = (grams: number) =>
    calculateLandedCost(
      chinaInput({ actualWeightGrams: grams, dimensionsCm: null }),
      rules(),
      fxRows(),
    ).lines.find((line) => line.type === "international_freight")!.ruleId;

  it.each([
    [1, "cn-freight-1"],
    [4999, "cn-freight-1"],
    [5000, "cn-freight-2"], // exactly on the boundary: the higher band
    [5001, "cn-freight-2"],
    [19_999, "cn-freight-2"],
    [20_000, "cn-freight-3"],
    [99_999, "cn-freight-3"],
  ])("%i g uses %s", (grams, expected) => {
    expect(freightRule(grams)).toBe(expected);
  });

  it("names the missing band for a weight above the last one", () => {
    const error = fails(() =>
      calculateLandedCost(chinaInput({ actualWeightGrams: 100_000, dimensionsCm: null }), rules(), fxRows()),
    );
    expect(error.code).toBe("MISSING_RULE");
    expect(error.message).toContain("international freight");
    expect(error.message).toContain("100000 g");
  });

  it("applies the minimum charge of the lightest band", () => {
    // 100 g x 900 cents/kg = 90 cents, raised to the 900 cent minimum
    const freight = calculateLandedCost(
      chinaInput({ actualWeightGrams: 100, dimensionsCm: null }),
      rules(),
      fxRows(),
    ).lines.find((line) => line.type === "international_freight")!;
    expect(freight.nativeAmountMinor).toBe(900);
  });
});

describe("rule selection", () => {
  it("throws when two rules for the same fee overlap", () => {
    const overlapping = [
      ...feeRules(),
      fee({ id: "dup-clearing", feeType: "clearing", calcMethod: "flat", value: 1, currency: "NGN" }),
    ];
    const error = fails(() =>
      calculateLandedCost(chinaInput(), { ...rules(), feeRules: overlapping }, fxRows()),
    );
    expect(error.code).toBe("OVERLAPPING_RULES");
    expect(error.message).toContain("cn-clearing");
    expect(error.message).toContain("dup-clearing");
  });

  it("throws when two duty rates overlap", () => {
    const rates = [...dutyRates(), { ...dutyRates()[2], id: "duty-phones-2" }];
    const error = fails(() => calculateLandedCost(chinaInput(), { ...rules(), dutyRates: rates }, fxRows()));
    expect(error.code).toBe("OVERLAPPING_RULES");
  });

  it("does not treat a closed rule or a different band as an overlap", () => {
    const closed: FeeRule = fee({
      id: "old-clearing",
      feeType: "clearing",
      calcMethod: "flat",
      value: 1,
      currency: "NGN",
      effectiveTo: "2026-06-01T00:00:00.000Z",
    });
    const result = calculateLandedCost(
      chinaInput(),
      { ...rules(), feeRules: [...feeRules(), closed] },
      fxRows(),
    );
    expect(result.lines.find((line) => line.type === "clearing")?.ruleId).toBe("cn-clearing");
  });

  it("reads the rule that was in force at the calculation time", () => {
    // Rate change: old clearing rule closes at 2026-10-01, a new one starts then.
    const history = feeRules().filter((r) => r.id !== "cn-clearing");
    history.push(
      fee({
        id: "clearing-old",
        feeType: "clearing",
        calcMethod: "flat",
        value: 400000,
        currency: "NGN",
        effectiveTo: "2026-10-01T00:00:00.000Z",
      }),
      fee({
        id: "clearing-new",
        feeType: "clearing",
        calcMethod: "flat",
        value: 600000,
        currency: "NGN",
        effectiveFrom: "2026-10-01T00:00:00.000Z",
      }),
    );
    const before = calculateLandedCost(
      chinaInput({ now: "2026-09-30T23:59:59.000Z" }),
      { ...rules(), feeRules: history },
      fxRows({ ageHours: 2 }).map((r) => ({ ...r, fetchedAt: "2026-09-30T20:00:00.000Z" })),
    );
    const at = calculateLandedCost(
      chinaInput({ now: "2026-10-01T00:00:00.000Z" }),
      { ...rules(), feeRules: history },
      fxRows().map((r) => ({ ...r, fetchedAt: "2026-09-30T20:00:00.000Z" })),
    );
    expect(before.lines.find((l) => l.type === "clearing")?.ruleId).toBe("clearing-old");
    expect(at.lines.find((l) => l.type === "clearing")?.ruleId).toBe("clearing-new");
  });

  it("names the missing rule instead of defaulting to zero", () => {
    for (const [removed, text] of [
      ["cn-clearing", "clearing"],
      ["cn-service", "service fee"],
      ["cn-freight-1", "international freight"],
    ] as const) {
      const error = fails(() =>
        calculateLandedCost(
          chinaInput({ actualWeightGrams: 1500 }),
          { ...rules(), feeRules: feeRules().filter((r) => r.id !== removed) },
          fxRows(),
        ),
      );
      expect(error.code).toBe("MISSING_RULE");
      expect(error.message).toContain(text);
    }
    const noDuty = fails(() => calculateLandedCost(chinaInput(), { ...rules(), dutyRates: [] }, fxRows()));
    expect(noDuty.code).toBe("MISSING_RULE");
    expect(noDuty.message).toContain("duty rate");
  });

  it("needs a special handling rule only when the item is flagged", () => {
    const without = feeRules().filter((r) => r.feeType !== "special_handling");
    expect(() =>
      calculateLandedCost(chinaInput(), { ...rules(), feeRules: without }, fxRows()),
    ).not.toThrow();
    const error = fails(() =>
      calculateLandedCost(chinaInput({ specialHandling: true }), { ...rules(), feeRules: without }, fxRows()),
    );
    expect(error.message).toContain("special handling");
  });

  it("treats insurance and payment processing as optional", () => {
    const optional = feeRules().filter(
      (r) => r.feeType !== "insurance" && r.feeType !== "payment_processing",
    );
    const result = calculateLandedCost(chinaInput(), { ...rules(), feeRules: optional }, fxRows());
    expect(result.lines.some((l) => l.type === "insurance" || l.type === "payment_processing")).toBe(false);
  });

  it("names a state that is in no delivery zone", () => {
    const error = fails(() =>
      calculateLandedCost(chinaInput({ destinationState: "Atlantis" }), rules(), fxRows()),
    );
    expect(error.code).toBe("MISSING_RULE");
    expect(error.message).toContain("Atlantis");
  });

  describe("category-specific rules beat general ones", () => {
    const dutyOf = (category: string) => {
      const result = calculateLandedCost(chinaInput({ categorySlug: category }), rules(), fxRows());
      return result.lines.find((l) => l.type === "import_duty")!.ruleId;
    };
    it("picks the category, then its parent, then the general rate", () => {
      expect(dutyOf("phones")).toBe("duty-phones");
      expect(dutyOf("laptops")).toBe("duty-electronics"); // no laptop rule: the parent covers it
      expect(dutyOf("general")).toBe("duty-general");
    });

    it("lets a category fee rule beat the general fee rule", () => {
      const withPhoneFee = [
        ...feeRules(),
        fee({
          id: "phone-service",
          feeType: "service_fee",
          calcMethod: "percent",
          value: 2,
          currency: "NGN",
          categorySlug: "phones",
          minAmountMinor: 100,
        }),
      ];
      const phones = calculateLandedCost(chinaInput(), { ...rules(), feeRules: withPhoneFee }, fxRows());
      expect(phones.lines.find((l) => l.type === "service_fee")?.ruleId).toBe("phone-service");
      const laptops = calculateLandedCost(
        chinaInput({ categorySlug: "laptops" }),
        { ...rules(), feeRules: withPhoneFee },
        fxRows(),
      );
      expect(laptops.lines.find((l) => l.type === "service_fee")?.ruleId).toBe("cn-service");
    });
  });
});

describe("minimum and maximum amounts", () => {
  it("raises a small service fee to the minimum and caps a large one", () => {
    // 5% of NGN 1,000.00 is 50.00, below the 2,000.00 minimum
    const small = calculateLandedCost(
      nigeriaInput({ itemUnitPriceMinor: 100_000, buyerCurrency: "NGN", itemCurrency: "NGN" }),
      rules(),
      fxRows(),
    );
    expect(small.lines.find((l) => l.type === "service_fee")?.amountMinor).toBe(100_000);

    const capped = feeRules().map((r) => (r.id === "ng-service" ? { ...r, maxAmountMinor: 500_000 } : r));
    const large = calculateLandedCost(
      nigeriaInput({ buyerCurrency: "NGN" }),
      { ...rules(), feeRules: capped },
      fxRows(),
    );
    expect(large.lines.find((l) => l.type === "service_fee")?.amountMinor).toBe(500_000);
  });
});

describe("input checks", () => {
  const cases: [string, Partial<PricingInput>][] = [
    ["zero weight", { actualWeightGrams: 0 }],
    ["negative weight", { actualWeightGrams: -5 }],
    ["fractional weight", { actualWeightGrams: 10.5 }],
    ["zero quantity", { quantity: 0 }],
    ["negative quantity", { quantity: -1 }],
    ["zero price", { itemUnitPriceMinor: 0 }],
    ["negative price", { itemUnitPriceMinor: -100 }],
    ["fractional price", { itemUnitPriceMinor: 10.5 }],
    ["zero-width box", { dimensionsCm: { length: 10, width: 0, height: 10 } }],
    ["unknown currency", { buyerCurrency: "XXX" }],
  ];
  it.each(cases)("rejects %s", (_name, over) => {
    const error = fails(() => calculateLandedCost(chinaInput(over), rules(), fxRows()));
    expect(error.code).toBe("INVALID_INPUT");
  });
});

describe("snapshots", () => {
  it("reproduces the same lines and total after every rule and rate has changed", () => {
    const original = calculateLandedCost(chinaInput(), rules(), fxRows());

    // Later: new rules, new duty, a different exchange rate. The snapshot does not care.
    const changedRules = {
      ...rules(),
      feeRules: feeRules().map((r) => ({ ...r, value: Number(r.value) * 3 })),
      dutyRates: dutyRates().map((d) => ({ ...d, importDutyPercent: 99 })),
    };
    const changedLater = calculateLandedCost(
      chinaInput(),
      changedRules,
      fxRows().map((r) => ({ ...r, rate: "9999" })),
    );
    expect(changedLater.total).not.toBe(original.total);

    const replayed = replaySnapshot(JSON.parse(JSON.stringify(original.snapshot)));
    expect(replayed.total).toBe(original.total);
    expect(replayed.lines).toEqual(original.lines);
    expect(snapshotReproduces(JSON.parse(JSON.stringify(original.snapshot)))).toBe(true);
  });

  it("holds only what the calculation used, copied by value", () => {
    const result = calculateLandedCost(chinaInput(), rules(), fxRows());
    const { data, engine_version, input } = result.snapshot;
    expect(engine_version).toBe("1");
    expect(input.corridor.id).toBe(CN_NG.id);
    expect(data.dutyRates.map((d) => d.id)).toEqual(["duty-phones"]);
    expect(data.zones.map((z) => z.id)).toEqual(["zone-a"]);
    expect(data.feeRules.map((r) => r.id).sort()).toEqual(
      [
        "cn-clearing",
        "cn-freight-1",
        "cn-insurance",
        "cn-pay-flat",
        "cn-pay-pct",
        "cn-service",
        "lm-corridor-cn-ng-zone-a-0",
      ].sort(),
    );
    expect(data.fxRows.map((r) => r.id).sort()).toEqual(["fx-usd-cny", "fx-usd-ngn"]);
  });
});
