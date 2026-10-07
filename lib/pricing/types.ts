import type { FxRow } from "@/lib/fx/convert";

/** Money-carrying numbers cross the database boundary as numbers or exact text. */
export type Numeric = string | number;

export const FEE_TYPES = [
  "service_fee",
  "international_freight",
  "clearing",
  "last_mile",
  "special_handling",
  "insurance",
  "fx_spread",
  "payment_processing",
] as const;
export type FeeType = (typeof FEE_TYPES)[number];

export const CALC_METHODS = ["flat", "percent", "per_kg"] as const;
export type CalcMethod = (typeof CALC_METHODS)[number];

export type FeeRule = {
  id: string;
  corridorId: string;
  feeType: FeeType;
  calcMethod: CalcMethod;
  /** Minor units for flat and per_kg, percent for percent. */
  value: Numeric;
  currency: string;
  minAmountMinor: Numeric | null;
  maxAmountMinor: Numeric | null;
  /** Band start, inclusive. Null = from 0. */
  weightFromG: number | null;
  /** Band end, exclusive. Null = no upper limit. */
  weightToG: number | null;
  categorySlug: string | null;
  zoneId: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
};

export type DutyRate = {
  id: string;
  corridorId: string;
  categorySlug: string | null;
  importDutyPercent: Numeric;
  vatPercent: Numeric;
  otherLeviesPercent: Numeric;
  effectiveFrom: string;
  effectiveTo: string | null;
};

export type DeliveryZone = { id: string; name: string; states: string[] };
export type CategoryNode = { slug: string; parentSlug: string | null };
export type CurrencyInfo = { code: string; minorUnitDigits: number };

export type PricingCorridor = {
  id: string;
  name: string;
  originCountry: string;
  destinationCountry: string;
};

export type PricingInput = {
  /** The moment prices are worked out for, ISO text. Rules and rates are read as of then. */
  now: string;
  itemUnitPriceMinor: number;
  itemCurrency: string;
  quantity: number;
  actualWeightGrams: number;
  dimensionsCm: { length: number; width: number; height: number } | null;
  categorySlug: string;
  corridor: PricingCorridor;
  destinationState: string;
  buyerCurrency: string;
  specialHandling: boolean;
};

/** Everything the engine needs besides the order itself. Loaded by lib/pricing/loader.ts. */
export type PricingRules = {
  feeRules: FeeRule[];
  dutyRates: DutyRate[];
  zones: DeliveryZone[];
  categories: CategoryNode[];
  currencies: CurrencyInfo[];
};

export type PricingData = PricingRules & { fxRows: FxRow[] };

export const LINE_TYPES = [
  "item_price",
  "international_freight",
  "insurance",
  "import_duty",
  "other_levies",
  "vat",
  "clearing",
  "special_handling",
  "last_mile_delivery",
  "service_fee",
  "payment_processing",
  "fx_spread",
] as const;
export type EngineLineType = (typeof LINE_TYPES)[number];

export type LandedCostLine = {
  type: EngineLineType;
  label: string;
  /** In the buyer's currency. These add up to `total` exactly. */
  amountMinor: number;
  /** What the line was before conversion. */
  nativeCurrency: string;
  nativeAmountMinor: number;
  /** True for customs lines: the buyer sees them marked as estimates. */
  estimated: boolean;
  /** The fee rule or duty rate behind the line. Null for the item and the conversion fee. */
  ruleId: string | null;
};

export type PricingWarning = { code: "VOLUMETRIC_SKIPPED"; message: string };

export const ENGINE_VERSION = "1";

export const CUSTOMS_DISCLAIMER =
  "Customs charges are estimates. Final duty is set by Nigeria Customs Service.";

export type PricingSnapshot = {
  engine_version: string;
  input: PricingInput;
  /** Only the rules and rates the calculation used, copied by value. */
  data: PricingData;
  output: {
    lines: Pick<LandedCostLine, "type" | "label" | "amountMinor">[];
    total: number;
    currency: string;
  };
};

export type LandedCost = {
  lines: LandedCostLine[];
  /** Sum of `lines`, in the buyer's currency minor units. */
  total: number;
  currency: string;
  chargeableWeightGrams: number;
  weightBasis: "actual" | "volumetric";
  warnings: PricingWarning[];
  /** Shown to the buyer next to customs lines. Null when there are none. */
  customsDisclaimer: string | null;
  snapshot: PricingSnapshot;
};
