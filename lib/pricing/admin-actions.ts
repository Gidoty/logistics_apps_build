"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { requireAdmin } from "@/lib/auth/session";
import { userFacingDbError } from "@/lib/db-errors";
import { isPricingError } from "./errors";
import { PRICING_CACHE_TAG } from "./cache-tags";
import {
  createDutyRateSchema,
  createFeeRuleSchema,
  fieldErrorsFromIssues,
  fxOverrideSchema,
  fxSpreadSchema,
  replaceDutyRateSchema,
  replaceFeeRuleSchema,
  zoneSchema,
  type PricingAdminContext,
} from "./admin-schemas";
import { createCalcRequestSchema } from "./input";
import { loadCalcOptions } from "./options";
import { calculateFromRequest } from "./service";
import { toCalcView, type CalcView } from "./view";
import { createClient } from "@/lib/supabase/server";
import { z } from "zod";

export type PricingAdminResult =
  { ok: true; message: string } | { ok: false; message: string; fieldErrors?: Record<string, string[]> };

const invalid = (error: z.ZodError): PricingAdminResult => ({
  ok: false,
  message: "Please fix the highlighted fields.",
  fieldErrors: fieldErrorsFromIssues(error.issues),
});

/** Rules, rates and zones feed every price, so a change clears the cached prices as well as the admin page. */
function refreshPricing() {
  revalidateTag(PRICING_CACHE_TAG, { expire: 0 });
  revalidatePath("/admin/pricing");
  revalidatePath("/shop");
  revalidatePath("/estimate");
}

async function adminContext(): Promise<PricingAdminContext> {
  const supabase = await createClient();
  const [options, zones, categories] = await Promise.all([
    loadCalcOptions(),
    supabase.from("delivery_zones").select("id"),
    supabase.from("categories").select("slug").eq("prohibited", false),
  ]);
  if (zones.error || categories.error) throw new Error("Could not load pricing options");
  return {
    currencies: options.context.currencies,
    corridorIds: options.context.corridorIds,
    categorySlugs: categories.data.map((category) => category.slug),
    zoneIds: zones.data.map((zone) => zone.id),
  };
}

type Raw = Record<string, unknown>;
const asRaw = (input: unknown): Raw => (typeof input === "object" && input !== null ? (input as Raw) : {});

export async function createFeeRule(input: unknown): Promise<PricingAdminResult> {
  await requireAdmin("/admin/pricing");
  const parsed = createFeeRuleSchema(await adminContext()).safeParse(asRaw(input));
  if (!parsed.success) return invalid(parsed.error);
  const r = parsed.data;
  const { error } = await (
    await createClient()
  ).rpc("create_fee_rule", {
    _corridor_id: r.corridorId,
    _fee_type: r.feeType,
    _calc_method: r.calcMethod,
    _value: r.value,
    _currency: r.currency,
    ...(r.minAmountMinor !== null ? { _min_amount_minor: r.minAmountMinor } : {}),
    ...(r.maxAmountMinor !== null ? { _max_amount_minor: r.maxAmountMinor } : {}),
    ...(r.weightFromG !== null ? { _weight_from_g: r.weightFromG } : {}),
    ...(r.weightToG !== null ? { _weight_to_g: r.weightToG } : {}),
    ...(r.categorySlug !== null ? { _category_slug: r.categorySlug } : {}),
    ...(r.zoneId !== null ? { _zone_id: r.zoneId } : {}),
    ...(r.notes !== null ? { _notes: r.notes } : {}),
  });
  if (error)
    return { ok: false, message: userFacingDbError(error, "We could not save the rule. Please try again.") };
  refreshPricing();
  return { ok: true, message: "Rule added." };
}

/** Changing a rate: the old rule closes and a new one starts at the same instant. */
export async function replaceFeeRule(input: unknown): Promise<PricingAdminResult> {
  await requireAdmin("/admin/pricing");
  const parsed = replaceFeeRuleSchema(await adminContext()).safeParse(asRaw(input));
  if (!parsed.success) return invalid(parsed.error);
  const r = parsed.data;
  const { error } = await (
    await createClient()
  ).rpc("replace_fee_rule", {
    _old_id: r.ruleId,
    _calc_method: r.calcMethod,
    _value: r.value,
    _currency: r.currency,
    ...(r.minAmountMinor !== null ? { _min_amount_minor: r.minAmountMinor } : {}),
    ...(r.maxAmountMinor !== null ? { _max_amount_minor: r.maxAmountMinor } : {}),
    ...(r.weightFromG !== null ? { _weight_from_g: r.weightFromG } : {}),
    ...(r.weightToG !== null ? { _weight_to_g: r.weightToG } : {}),
    ...(r.notes !== null ? { _notes: r.notes } : {}),
  });
  if (error)
    return {
      ok: false,
      message: userFacingDbError(error, "We could not change the rule. Please try again."),
    };
  refreshPricing();
  return { ok: true, message: "Rate changed. The old rule is closed and kept in the history." };
}

export async function closeFeeRule(ruleId: string): Promise<PricingAdminResult> {
  await requireAdmin("/admin/pricing");
  if (!z.uuid().safeParse(ruleId).success) return { ok: false, message: "Rule not found." };
  const { error } = await (await createClient()).rpc("close_fee_rule", { _id: ruleId });
  if (error) return { ok: false, message: userFacingDbError(error, "We could not close the rule.") };
  refreshPricing();
  return { ok: true, message: "Rule closed." };
}

export async function createDutyRate(input: unknown): Promise<PricingAdminResult> {
  await requireAdmin("/admin/pricing");
  const parsed = createDutyRateSchema(await adminContext()).safeParse(asRaw(input));
  if (!parsed.success) return invalid(parsed.error);
  const r = parsed.data;
  const { error } = await (
    await createClient()
  ).rpc("create_duty_rate", {
    _corridor_id: r.corridorId,
    _category_slug: r.categorySlug as string,
    _import_duty_percent: r.importDutyPercent,
    _vat_percent: r.vatPercent,
    _other_levies_percent: r.otherLeviesPercent,
    ...(r.notes !== null ? { _notes: r.notes } : {}),
  });
  if (error) return { ok: false, message: userFacingDbError(error, "We could not save the duty rate.") };
  refreshPricing();
  return { ok: true, message: "Duty rate added." };
}

export async function replaceDutyRate(input: unknown): Promise<PricingAdminResult> {
  await requireAdmin("/admin/pricing");
  const parsed = replaceDutyRateSchema.safeParse(asRaw(input));
  if (!parsed.success) return invalid(parsed.error);
  const r = parsed.data;
  const { error } = await (
    await createClient()
  ).rpc("replace_duty_rate", {
    _old_id: r.ruleId,
    _import_duty_percent: r.importDutyPercent,
    _vat_percent: r.vatPercent,
    _other_levies_percent: r.otherLeviesPercent,
    ...(r.notes !== null ? { _notes: r.notes } : {}),
  });
  if (error) return { ok: false, message: userFacingDbError(error, "We could not change the duty rate.") };
  refreshPricing();
  return { ok: true, message: "Duty rate changed. The old rate is closed and kept in the history." };
}

export async function closeDutyRate(rateId: string): Promise<PricingAdminResult> {
  await requireAdmin("/admin/pricing");
  if (!z.uuid().safeParse(rateId).success) return { ok: false, message: "Duty rate not found." };
  const { error } = await (await createClient()).rpc("close_duty_rate", { _id: rateId });
  if (error) return { ok: false, message: userFacingDbError(error, "We could not close the duty rate.") };
  refreshPricing();
  return { ok: true, message: "Duty rate closed." };
}

export async function saveDeliveryZone(input: unknown): Promise<PricingAdminResult> {
  await requireAdmin("/admin/pricing");
  const options = await loadCalcOptions();
  const parsed = zoneSchema(options.states).safeParse(asRaw(input));
  if (!parsed.success) return invalid(parsed.error);
  const z1 = parsed.data;
  const { error } = await (
    await createClient()
  ).rpc("save_delivery_zone", {
    _id: z1.zoneId as string,
    _name: z1.name,
    _states: z1.states,
  });
  if (error) return { ok: false, message: userFacingDbError(error, "We could not save the zone.") };
  refreshPricing();
  return { ok: true, message: "Zone saved." };
}

export async function setFxOverride(input: unknown): Promise<PricingAdminResult> {
  await requireAdmin("/admin/pricing");
  const parsed = fxOverrideSchema.safeParse(asRaw(input));
  if (!parsed.success) return invalid(parsed.error);
  const { error } = await (
    await createClient()
  ).rpc("set_fx_override", {
    _base: "USD",
    _quote: parsed.data.quote,
    _rate: Number(parsed.data.rate),
  });
  if (error) return { ok: false, message: userFacingDbError(error, "We could not set the override.") };
  refreshPricing();
  return { ok: true, message: "Override set. It replaces the fetched rate until you remove it." };
}

export async function removeFxOverride(quote: string): Promise<PricingAdminResult> {
  await requireAdmin("/admin/pricing");
  if (!/^[A-Z]{3}$/.test(quote)) return { ok: false, message: "Choose a currency." };
  const { error } = await (await createClient()).rpc("remove_fx_override", { _base: "USD", _quote: quote });
  if (error) return { ok: false, message: userFacingDbError(error, "We could not remove the override.") };
  refreshPricing();
  return { ok: true, message: "Override removed. The fetched rate applies again." };
}

export async function setFxSpread(input: unknown): Promise<PricingAdminResult> {
  await requireAdmin("/admin/pricing");
  const parsed = fxSpreadSchema.safeParse(asRaw(input));
  if (!parsed.success) return invalid(parsed.error);
  const { error } = await (
    await createClient()
  ).rpc("set_fx_spread", {
    _base: "USD",
    _quote: parsed.data.quote,
    _spread_percent: Number(parsed.data.spread),
  });
  if (error) return { ok: false, message: userFacingDbError(error, "We could not save the conversion fee.") };
  refreshPricing();
  return { ok: true, message: "Conversion fee saved." };
}

export type TestCalculationResult =
  | { ok: true; view: CalcView }
  | { ok: false; message: string; code?: string; fieldErrors?: Record<string, string[]> };

/** Runs the engine on the live rules with the details typed in. Creates nothing. */
export async function testCalculation(input: unknown): Promise<TestCalculationResult> {
  await requireAdmin("/admin/pricing");
  const options = await loadCalcOptions();
  const raw = asRaw(input);
  const parsed = createCalcRequestSchema(options.context).safeParse({
    ...raw,
    specialHandling: raw.specialHandling === true,
  });
  if (!parsed.success) {
    return {
      ok: false,
      message: "Please fix the highlighted fields.",
      fieldErrors: fieldErrorsFromIssues(parsed.error.issues),
    };
  }
  try {
    const result = await calculateFromRequest(parsed.data, { fresh: true });
    return { ok: true, view: toCalcView(result, options.context.currencies[result.currency] ?? 2) };
  } catch (error) {
    if (isPricingError(error)) return { ok: false, code: error.code, message: error.message };
    console.error("Test calculation failed", error);
    return { ok: false, message: "The calculation failed. Please try again." };
  }
}
