import { parseScaled, pow10, roundHalfUpDiv, toSafeNumber } from "@/lib/fx/decimal";
import { convertMinor, resolveRate, type FxRow } from "@/lib/fx/convert";
import { PricingError } from "./errors";
import { categoryChain, findDutyRate, findFeeRules, findZone } from "./rules";
import {
  CUSTOMS_DISCLAIMER,
  ENGINE_VERSION,
  type CurrencyInfo,
  type DeliveryZone,
  type DutyRate,
  type EngineLineType,
  type FeeRule,
  type FeeType,
  type LandedCost,
  type LandedCostLine,
  type PricingData,
  type PricingInput,
  type PricingRules,
  type PricingWarning,
} from "./types";

/**
 * The landed-cost engine. Pure: no database, no clock, no network. Rules,
 * duty rates and exchange rows are passed in and `input.now` says when to read
 * them. All money is BigInt minor units; nothing is a float.
 *
 * Order of work (each line is rounded half up on its own, the total is the
 * sum of the rounded lines):
 *   item subtotal, chargeable weight, freight, insurance, customs value (CIF in NGN),
 *   duty / levies / VAT, clearing, special handling, last mile, service fee,
 *   conversion of every line to the buyer's currency, the conversion fee,
 *   and finally payment processing on everything else.
 */

/** Customs value and duty are worked out in naira. */
export const CUSTOMS_CURRENCY = "NGN";
const MAX_QUANTITY = 1000;
const MAX_ITEM_MINOR = 1_000_000_000_000;
const PERCENT_DIVISOR = 1_000_000n; // percent x 10^4, then / 100

type Line = {
  type: EngineLineType;
  label: string;
  nativeCurrency: string;
  nativeAmount: bigint;
  estimated: boolean;
  ruleId: string | null;
  /** Payment processing is computed in the buyer's currency and pays no conversion fee. */
  convert: boolean;
};

function invalid(message: string): never {
  throw new PricingError("INVALID_INPUT", message);
}

function validateInput(input: PricingInput): void {
  if (Number.isNaN(new Date(input.now).getTime())) invalid("The calculation time is not a valid date");
  if (!Number.isInteger(input.itemUnitPriceMinor) || input.itemUnitPriceMinor <= 0)
    invalid("The item price must be above zero");
  if (input.itemUnitPriceMinor > MAX_ITEM_MINOR) invalid("The item price is too large");
  if (!Number.isInteger(input.quantity) || input.quantity <= 0) invalid("The quantity must be at least 1");
  if (input.quantity > MAX_QUANTITY) invalid(`The quantity cannot be more than ${MAX_QUANTITY}`);
  if (!Number.isInteger(input.actualWeightGrams) || input.actualWeightGrams <= 0)
    invalid("The weight must be above zero grams");
  if (input.dimensionsCm) {
    for (const [name, value] of Object.entries(input.dimensionsCm)) {
      if (!Number.isFinite(value) || value <= 0) invalid(`The ${name} must be above zero`);
    }
  }
  if (!input.categorySlug) invalid("Choose a category");
  if (!input.destinationState) invalid("Choose a destination state");
}

/** Dimensions in cm (up to 2 decimals) to chargeable weight: L x W x H / 5000 kg, in grams. */
function volumetricGrams(d: { length: number; width: number; height: number }): bigint {
  const scaled = (value: number) => {
    const hundredths = Math.round(value * 100);
    if (Math.abs(value * 100 - hundredths) > 1e-6) invalid("Dimensions can have up to 2 decimal places");
    return BigInt(hundredths);
  };
  // cm^3 x 10^6 / 5 = grams x 10^6 (5000 cm^3 per kg = 5 cm^3 per gram)
  return roundHalfUpDiv(scaled(d.length) * scaled(d.width) * scaled(d.height), 5_000_000n);
}

function missingRule(what: string, input: PricingInput, extra: string): never {
  throw new PricingError(
    "MISSING_RULE",
    `No ${what} rule for ${input.corridor.name}${extra} on ${input.now.slice(0, 10)}. ` +
      "Add one in Admin > Pricing so this can be quoted.",
    { what, corridorId: input.corridor.id },
  );
}

export function calculateLandedCost(
  input: PricingInput,
  rules: PricingRules,
  fxRows: readonly FxRow[],
): LandedCost {
  validateInput(input);
  const now = new Date(input.now);
  const warnings: PricingWarning[] = [];

  // What the calculation touched, copied into the snapshot.
  const used = {
    feeRules: new Map<string, FeeRule>(),
    dutyRates: new Map<string, DutyRate>(),
    zones: new Map<string, DeliveryZone>(),
    fxRows: new Map<string, FxRow>(),
    currencies: new Map<string, CurrencyInfo>(),
  };

  const currencyOf = (code: string): CurrencyInfo => {
    const found = rules.currencies.find((currency) => currency.code === code);
    if (!found) invalid(`The currency ${code} is not set up`);
    used.currencies.set(code, found);
    return found;
  };
  const digits = (code: string) => currencyOf(code).minorUnitDigits;

  // Native-currency conversion without the fee: for fee bases and the customs value.
  const rateCache = new Map<string, ReturnType<typeof resolveRate>>();
  const rate = (from: string, to: string) => {
    const key = `${from}>${to}`;
    let resolved = rateCache.get(key);
    if (!resolved) {
      resolved = resolveRate(from, to, fxRows, now);
      rateCache.set(key, resolved);
      for (const row of resolved.rows) used.fxRows.set(row.id, row);
    }
    return resolved;
  };
  const convert = (amount: bigint, from: string, to: string): bigint =>
    from === to ? amount : convertMinor(amount, digits(from), digits(to), rate(from, to).ratio);

  const crossBorder = input.corridor.originCountry !== input.corridor.destinationCountry;
  const chain = categoryChain(input.categorySlug, rules.categories);
  const buyer = input.buyerCurrency;
  currencyOf(buyer);
  currencyOf(input.itemCurrency);

  // a) item subtotal, in the item's currency
  const itemSubtotal = BigInt(input.itemUnitPriceMinor) * BigInt(input.quantity);

  // b) chargeable weight
  let chargeable = BigInt(input.actualWeightGrams);
  let weightBasis: "actual" | "volumetric" = "actual";
  if (input.dimensionsCm) {
    const volumetric = volumetricGrams(input.dimensionsCm);
    if (volumetric > chargeable) {
      chargeable = volumetric;
      weightBasis = "volumetric";
    }
  } else {
    warnings.push({
      code: "VOLUMETRIC_SKIPPED",
      message: "No box size was given, so the weight is the actual weight. A large light box may cost more.",
    });
  }
  const chargeableGrams = toSafeNumber(chargeable, "weight");

  const lines: Line[] = [];
  const addLine = (line: Omit<Line, "convert"> & { convert?: boolean }) => {
    lines.push({ convert: true, ...line });
  };

  const feeBase = (currency: string) => convert(itemSubtotal, input.itemCurrency, currency);

  /** The fee in the rule's own currency, clamped to the rule's min and max. */
  const computeFee = (rule: FeeRule, base: bigint): bigint => {
    let amount: bigint;
    if (rule.calcMethod === "flat") {
      amount = wholeMinor(rule.value);
    } else if (rule.calcMethod === "per_kg") {
      amount = roundHalfUpDiv(wholeMinor(rule.value) * chargeable, 1000n);
    } else {
      amount = roundHalfUpDiv(base * parseScaled(rule.value, 4, "percent"), PERCENT_DIVISOR);
    }
    if (rule.minAmountMinor !== null) {
      const min = wholeMinor(rule.minAmountMinor);
      if (amount < min) amount = min;
    }
    if (rule.maxAmountMinor !== null) {
      const max = wholeMinor(rule.maxAmountMinor);
      if (amount > max) amount = max;
    }
    return amount;
  };

  const recordRule = (rule: FeeRule) => {
    used.feeRules.set(rule.id, rule);
    currencyOf(rule.currency);
  };

  const pick = (feeType: FeeType, zone: DeliveryZone | null = null): FeeRule[] =>
    findFeeRules(rules.feeRules, {
      corridorId: input.corridor.id,
      feeType,
      now,
      chain,
      weightGrams: chargeableGrams,
      zone,
    });

  const requireOne = (feeType: FeeType, zone: DeliveryZone | null = null): FeeRule => {
    const [rule] = pick(feeType, zone);
    if (!rule) {
      const where = [
        `at ${chargeableGrams} g`,
        zone ? `for ${zone.name}` : null,
        `for category ${input.categorySlug}`,
      ]
        .filter(Boolean)
        .join(" ");
      missingRule(feeType.replaceAll("_", " "), input, ` ${where}`);
    }
    recordRule(rule);
    return rule;
  };

  // c) international freight
  let freight: { rule: FeeRule; amount: bigint } | null = null;
  if (crossBorder) {
    const rule = requireOne("international_freight");
    freight = { rule, amount: computeFee(rule, feeBase(rule.currency)) };
  }

  // d) insurance (optional)
  let insurance: { rule: FeeRule; amount: bigint } | null = null;
  {
    const [rule] = pick("insurance");
    if (rule) {
      recordRule(rule);
      insurance = { rule, amount: computeFee(rule, feeBase(rule.currency)) };
    }
  }

  // Lines in display order. The item line first.
  addLine({
    type: "item_price",
    label: input.quantity > 1 ? `Item price (${input.quantity} items)` : "Item price",
    nativeCurrency: input.itemCurrency,
    nativeAmount: itemSubtotal,
    estimated: false,
    ruleId: null,
  });
  if (freight) {
    addLine({
      type: "international_freight",
      label: "International freight",
      nativeCurrency: freight.rule.currency,
      nativeAmount: freight.amount,
      estimated: false,
      ruleId: freight.rule.id,
    });
  }
  if (insurance) {
    addLine({
      type: "insurance",
      label: "Insurance",
      nativeCurrency: insurance.rule.currency,
      nativeAmount: insurance.amount,
      estimated: false,
      ruleId: insurance.rule.id,
    });
  }

  // e, f) customs: CIF value in naira, then duty, levies and VAT
  if (crossBorder) {
    const duty = findDutyRate(rules.dutyRates, input.corridor.id, now, chain);
    if (!duty) {
      missingRule("duty rate", input, ` for category ${input.categorySlug}`);
    }
    used.dutyRates.set(duty.id, duty);
    currencyOf(CUSTOMS_CURRENCY);

    const cif =
      convert(itemSubtotal, input.itemCurrency, CUSTOMS_CURRENCY) +
      (freight ? convert(freight.amount, freight.rule.currency, CUSTOMS_CURRENCY) : 0n) +
      (insurance ? convert(insurance.amount, insurance.rule.currency, CUSTOMS_CURRENCY) : 0n);
    const percentOf = (base: bigint, percent: string | number, label: string) =>
      roundHalfUpDiv(base * parseScaled(percent, 4, label), PERCENT_DIVISOR);
    const importDuty = percentOf(cif, duty.importDutyPercent, "import duty");
    const levies = percentOf(cif, duty.otherLeviesPercent, "other levies");
    const vat = percentOf(cif + importDuty + levies, duty.vatPercent, "VAT");

    for (const [type, label, amount] of [
      ["import_duty", "Import duty (Estimated)", importDuty],
      ["other_levies", "Other customs levies (Estimated)", levies],
      ["vat", "VAT on imports (Estimated)", vat],
    ] as const) {
      addLine({
        type,
        label,
        nativeCurrency: CUSTOMS_CURRENCY,
        nativeAmount: amount,
        estimated: true,
        ruleId: duty.id,
      });
    }
  }

  // g) clearing, special handling, last mile
  if (crossBorder) {
    const rule = requireOne("clearing");
    addLine({
      type: "clearing",
      label: "Customs clearing",
      nativeCurrency: rule.currency,
      nativeAmount: computeFee(rule, feeBase(rule.currency)),
      estimated: false,
      ruleId: rule.id,
    });
  }
  if (input.specialHandling) {
    const rule = requireOne("special_handling");
    addLine({
      type: "special_handling",
      label: "Special handling",
      nativeCurrency: rule.currency,
      nativeAmount: computeFee(rule, feeBase(rule.currency)),
      estimated: false,
      ruleId: rule.id,
    });
  }
  {
    const zone = findZone(rules.zones, input.destinationState);
    if (!zone) {
      throw new PricingError(
        "MISSING_RULE",
        `No delivery zone contains the state "${input.destinationState}". Add it to a zone in Admin > Pricing > Delivery zones.`,
        { state: input.destinationState },
      );
    }
    used.zones.set(zone.id, zone);
    const rule = requireOne("last_mile", zone);
    addLine({
      type: "last_mile_delivery",
      label: `Delivery to ${input.destinationState}`,
      nativeCurrency: rule.currency,
      nativeAmount: computeFee(rule, feeBase(rule.currency)),
      estimated: false,
      ruleId: rule.id,
    });
  }

  // h) service fee
  {
    const rule = requireOne("service_fee");
    addLine({
      type: "service_fee",
      label: "Service fee",
      nativeCurrency: rule.currency,
      nativeAmount: computeFee(rule, feeBase(rule.currency)),
      estimated: false,
      ruleId: rule.id,
    });
  }

  // j) convert each line to the buyer's currency, round it, and total the conversion fee
  const converted: LandedCostLine[] = [];
  let spreadTotal = 0n;
  const finished: { line: Line; amount: bigint }[] = [];
  for (const line of lines) {
    const amount = convert(line.nativeAmount, line.nativeCurrency, buyer);
    finished.push({ line, amount });
    if (line.nativeCurrency !== buyer) {
      const resolved = rate(line.nativeCurrency, buyer);
      spreadTotal += roundHalfUpDiv(amount * resolved.spreadScaled, PERCENT_DIVISOR);
    }
  }

  // i) payment processing, on everything else the buyer pays (incl. the conversion fee)
  let processing = 0n;
  let processingRuleId: string | null = null;
  const processingRules = pick("payment_processing");
  if (processingRules.length > 0) {
    const others = finished.reduce((sum, entry) => sum + entry.amount, 0n) + spreadTotal;
    for (const rule of processingRules) {
      recordRule(rule);
      processingRuleId = processingRuleId ?? rule.id;
      processing += computeProcessingPart(rule, others, buyer, convert, digits, chargeable);
    }
  }

  const build = (line: Line, amount: bigint): LandedCostLine => ({
    type: line.type,
    label: line.label,
    amountMinor: toSafeNumber(amount, "total"),
    nativeCurrency: line.nativeCurrency,
    nativeAmountMinor: toSafeNumber(line.nativeAmount, "amount"),
    estimated: line.estimated,
    ruleId: line.ruleId,
  });

  // Lines that round to nothing are left out, except the item.
  for (const { line, amount } of finished) {
    if (amount > 0n || line.type === "item_price") converted.push(build(line, amount));
  }
  if (processing > 0n) {
    converted.push(
      build(
        {
          type: "payment_processing",
          label: "Payment processing",
          nativeCurrency: buyer,
          nativeAmount: processing,
          estimated: false,
          ruleId: processingRuleId,
          convert: false,
        },
        processing,
      ),
    );
  }
  if (spreadTotal > 0n) {
    converted.push(
      build(
        {
          type: "fx_spread",
          label: "Currency conversion fee",
          nativeCurrency: buyer,
          nativeAmount: spreadTotal,
          estimated: false,
          ruleId: null,
          convert: false,
        },
        spreadTotal,
      ),
    );
  }

  // k) the total is the sum of the rounded lines
  const total = converted.reduce((sum, line) => sum + BigInt(line.amountMinor), 0n);
  const totalNumber = toSafeNumber(total, "total");

  const data: PricingData = {
    feeRules: [...used.feeRules.values()],
    dutyRates: [...used.dutyRates.values()],
    zones: [...used.zones.values()],
    categories: chain
      .filter((slug): slug is string => slug !== null)
      .map((slug) => ({
        slug,
        parentSlug: rules.categories.find((node) => node.slug === slug)?.parentSlug ?? null,
      })),
    currencies: [...used.currencies.values()],
    fxRows: [...used.fxRows.values()],
  };

  return {
    lines: converted,
    total: totalNumber,
    currency: buyer,
    chargeableWeightGrams: chargeableGrams,
    weightBasis,
    warnings,
    customsDisclaimer: converted.some((line) => line.estimated) ? CUSTOMS_DISCLAIMER : null,
    snapshot: {
      engine_version: ENGINE_VERSION,
      input,
      data,
      output: {
        lines: converted.map(({ type, label, amountMinor }) => ({ type, label, amountMinor })),
        total: totalNumber,
        currency: buyer,
      },
    },
  };
}

/** A whole number of minor units from a rule's value (text, or a number from the database). */
function wholeMinor(value: string | number): bigint {
  const scaled = parseScaled(value, 4, "amount");
  if (scaled % pow10(4) !== 0n) invalid("Amounts in a rule must be whole minor units");
  return scaled / pow10(4);
}

/**
 * One part of the payment processing fee, in the buyer's currency. A percent
 * rule takes its share of `base`; a flat or per-kg rule is converted from its
 * own currency. Min and max are in the rule's currency.
 */
function computeProcessingPart(
  rule: FeeRule,
  base: bigint,
  buyer: string,
  convert: (amount: bigint, from: string, to: string) => bigint,
  _digits: (code: string) => number,
  chargeable: bigint,
): bigint {
  let amount: bigint;
  if (rule.calcMethod === "percent") {
    amount = roundHalfUpDiv(base * parseScaled(rule.value, 4, "percent"), PERCENT_DIVISOR);
  } else if (rule.calcMethod === "per_kg") {
    amount = convert(roundHalfUpDiv(wholeMinor(rule.value) * chargeable, 1000n), rule.currency, buyer);
  } else {
    amount = convert(wholeMinor(rule.value), rule.currency, buyer);
  }
  if (rule.minAmountMinor !== null) {
    const min = convert(wholeMinor(rule.minAmountMinor), rule.currency, buyer);
    if (amount < min) amount = min;
  }
  if (rule.maxAmountMinor !== null) {
    const max = convert(wholeMinor(rule.maxAmountMinor), rule.currency, buyer);
    if (amount > max) amount = max;
  }
  return amount;
}
