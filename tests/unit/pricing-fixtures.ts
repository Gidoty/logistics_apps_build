import type { FxRow } from "@/lib/fx/convert";
import type {
  DeliveryZone,
  DutyRate,
  FeeRule,
  PricingCorridor,
  PricingInput,
  PricingRules,
} from "@/lib/pricing/types";

/** Fixed rules and rates for the pricing tests. Nothing here comes from a database. */

export const NOW = "2026-10-20T12:00:00.000Z";
const LONG_AGO = "2026-01-01T00:00:00.000Z";

export const CN_NG: PricingCorridor = {
  id: "corridor-cn-ng",
  name: "China to Nigeria",
  originCountry: "CN",
  destinationCountry: "NG",
};
export const NG_NG: PricingCorridor = {
  id: "corridor-ng-ng",
  name: "Within Nigeria",
  originCountry: "NG",
  destinationCountry: "NG",
};

export const ZONES: DeliveryZone[] = [
  { id: "zone-a", name: "Zone A", states: ["Lagos", "Federal Capital Territory", "Rivers"] },
  { id: "zone-b", name: "Zone B", states: ["Anambra", "Enugu", "Oyo"] },
  { id: "zone-c", name: "Zone C", states: ["Kano", "Kaduna"] },
];

export const CATEGORIES = [
  { slug: "electronics", parentSlug: null },
  { slug: "phones", parentSlug: "electronics" },
  { slug: "laptops", parentSlug: "electronics" },
  { slug: "general", parentSlug: null },
];

export const CURRENCIES = [
  { code: "NGN", minorUnitDigits: 2 },
  { code: "USD", minorUnitDigits: 2 },
  { code: "GBP", minorUnitDigits: 2 },
  { code: "CNY", minorUnitDigits: 2 },
];

let counter = 0;
export function fee(
  over: Partial<FeeRule> & Pick<FeeRule, "feeType" | "calcMethod" | "value" | "currency">,
): FeeRule {
  counter += 1;
  return {
    id: `fee-${counter}`,
    corridorId: CN_NG.id,
    minAmountMinor: null,
    maxAmountMinor: null,
    weightFromG: null,
    weightToG: null,
    categorySlug: null,
    zoneId: null,
    effectiveFrom: LONG_AGO,
    effectiveTo: null,
    ...over,
  };
}

function lastMile(corridorId: string, zoneId: string, values: [number, number, number]): FeeRule[] {
  const bands: [number, number][] = [
    [0, 5000],
    [5000, 20000],
    [20000, 100000],
  ];
  return bands.map(([from, to], index) =>
    fee({
      id: `lm-${corridorId}-${zoneId}-${index}`,
      corridorId,
      feeType: "last_mile",
      calcMethod: "flat",
      value: values[index],
      currency: "NGN",
      zoneId,
      weightFromG: from,
      weightToG: to,
    }),
  );
}

export function feeRules(): FeeRule[] {
  return [
    // China to Nigeria
    fee({
      id: "cn-service",
      feeType: "service_fee",
      calcMethod: "percent",
      value: 5,
      currency: "NGN",
      minAmountMinor: 200000,
    }),
    fee({
      id: "cn-freight-1",
      feeType: "international_freight",
      calcMethod: "per_kg",
      value: 900,
      currency: "USD",
      minAmountMinor: 900,
      weightFromG: 0,
      weightToG: 5000,
    }),
    fee({
      id: "cn-freight-2",
      feeType: "international_freight",
      calcMethod: "per_kg",
      value: 800,
      currency: "USD",
      weightFromG: 5000,
      weightToG: 20000,
    }),
    fee({
      id: "cn-freight-3",
      feeType: "international_freight",
      calcMethod: "per_kg",
      value: 650,
      currency: "USD",
      weightFromG: 20000,
      weightToG: 100000,
    }),
    fee({ id: "cn-insurance", feeType: "insurance", calcMethod: "percent", value: 1, currency: "USD" }),
    fee({ id: "cn-clearing", feeType: "clearing", calcMethod: "flat", value: 500000, currency: "NGN" }),
    fee({
      id: "cn-special",
      feeType: "special_handling",
      calcMethod: "flat",
      value: 300000,
      currency: "NGN",
    }),
    fee({
      id: "cn-pay-pct",
      feeType: "payment_processing",
      calcMethod: "percent",
      value: 1.5,
      currency: "NGN",
    }),
    fee({
      id: "cn-pay-flat",
      feeType: "payment_processing",
      calcMethod: "flat",
      value: 10000,
      currency: "NGN",
    }),
    ...lastMile(CN_NG.id, "zone-a", [250000, 400000, 900000]),
    ...lastMile(CN_NG.id, "zone-b", [350000, 550000, 1200000]),
    ...lastMile(CN_NG.id, "zone-c", [450000, 700000, 1500000]),
    // Within Nigeria
    fee({
      id: "ng-service",
      corridorId: NG_NG.id,
      feeType: "service_fee",
      calcMethod: "percent",
      value: 5,
      currency: "NGN",
      minAmountMinor: 100000,
    }),
    fee({
      id: "ng-special",
      corridorId: NG_NG.id,
      feeType: "special_handling",
      calcMethod: "flat",
      value: 300000,
      currency: "NGN",
    }),
    fee({
      id: "ng-pay-pct",
      corridorId: NG_NG.id,
      feeType: "payment_processing",
      calcMethod: "percent",
      value: 1.5,
      currency: "NGN",
    }),
    fee({
      id: "ng-pay-flat",
      corridorId: NG_NG.id,
      feeType: "payment_processing",
      calcMethod: "flat",
      value: 10000,
      currency: "NGN",
    }),
    ...lastMile(NG_NG.id, "zone-a", [250000, 400000, 900000]),
    ...lastMile(NG_NG.id, "zone-b", [350000, 550000, 1200000]),
    ...lastMile(NG_NG.id, "zone-c", [450000, 700000, 1500000]),
  ];
}

export function dutyRates(): DutyRate[] {
  const base = { corridorId: CN_NG.id, effectiveFrom: LONG_AGO, effectiveTo: null };
  return [
    {
      ...base,
      id: "duty-general",
      categorySlug: null,
      importDutyPercent: 20,
      vatPercent: 7.5,
      otherLeviesPercent: 4,
    },
    {
      ...base,
      id: "duty-electronics",
      categorySlug: "electronics",
      importDutyPercent: 10,
      vatPercent: 7.5,
      otherLeviesPercent: 4,
    },
    {
      ...base,
      id: "duty-phones",
      categorySlug: "phones",
      importDutyPercent: 5,
      vatPercent: 7.5,
      otherLeviesPercent: 4,
    },
  ];
}

export function rules(): PricingRules {
  return {
    feeRules: feeRules(),
    dutyRates: dutyRates(),
    zones: ZONES,
    categories: CATEGORIES,
    currencies: CURRENCIES,
  };
}

/** 1 USD = 1500 NGN = 7.2 CNY = 0.8 GBP, fetched 2 hours before NOW. Conversion fees: NGN 1.5%, GBP 2%, CNY 1%. */
export function fxRows(over: { ageHours?: number } = {}): FxRow[] {
  const fetchedAt = new Date(new Date(NOW).getTime() - (over.ageHours ?? 2) * 3_600_000).toISOString();
  const row = (quote: string, rate: string, spread: string): FxRow => ({
    id: `fx-usd-${quote.toLowerCase()}`,
    base: "USD",
    quote,
    rate,
    source: "test",
    isOverride: false,
    endedAt: null,
    fetchedAt,
    spreadPercent: spread,
  });
  return [row("NGN", "1500.00000000", "1.5"), row("CNY", "7.20000000", "1"), row("GBP", "0.80000000", "2")];
}

export function chinaInput(over: Partial<PricingInput> = {}): PricingInput {
  return {
    now: NOW,
    itemUnitPriceMinor: 20000, // CNY 200.00
    itemCurrency: "CNY",
    quantity: 2,
    actualWeightGrams: 1500,
    dimensionsCm: { length: 30, width: 20, height: 10 },
    categorySlug: "phones",
    corridor: CN_NG,
    destinationState: "Lagos",
    buyerCurrency: "NGN",
    specialHandling: false,
    ...over,
  };
}

export function nigeriaInput(over: Partial<PricingInput> = {}): PricingInput {
  return {
    now: NOW,
    itemUnitPriceMinor: 15_000_000, // NGN 150,000.00
    itemCurrency: "NGN",
    quantity: 1,
    actualWeightGrams: 800,
    dimensionsCm: { length: 20, width: 15, height: 10 },
    categorySlug: "general",
    corridor: NG_NG,
    destinationState: "Anambra",
    buyerCurrency: "GBP",
    specialHandling: true,
    ...over,
  };
}
