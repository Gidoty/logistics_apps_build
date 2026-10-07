import type { Metadata } from "next";
import Link from "next/link";
import { CloseRuleButton } from "@/components/pricing/close-rule-button";
import { DutyRateForm } from "@/components/pricing/duty-rate-form";
import { FeeRuleForm } from "@/components/pricing/fee-rule-form";
import { FxRowActions } from "@/components/pricing/fx-row-actions";
import { TestCalculation } from "@/components/pricing/test-calculation";
import { ZoneForm } from "@/components/pricing/zone-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireAdmin } from "@/lib/auth/session";
import { formatAge, formatDateTime } from "@/lib/orders/format";
import { FEE_TYPE_LABELS } from "@/lib/pricing/admin-schemas";
import {
  listDutyRatesForAdmin,
  listFeeRulesForAdmin,
  listFxStatus,
  listZonesForAdmin,
} from "@/lib/pricing/admin-queries";
import { formatBand, formatRuleValue } from "@/lib/pricing/format";
import { loadCalcOptions } from "@/lib/pricing/options";
import { createClient } from "@/lib/supabase/server";
import { minorToDecimalString } from "@/lib/money";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Admin: pricing" };

const TABS = [
  { value: "fees", label: "Fee rules" },
  { value: "duty", label: "Duty rates" },
  { value: "zones", label: "Delivery zones" },
  { value: "fx", label: "FX rates" },
] as const;

export default async function AdminPricingPage({ searchParams }: PageProps<"/admin/pricing">) {
  await requireAdmin("/admin/pricing");
  const query = await searchParams;
  const tab = TABS.find((item) => item.value === query.tab)?.value ?? "fees";
  const showClosed = query.closed === "1";

  const supabase = await createClient();
  const [options, categories, zones] = await Promise.all([
    loadCalcOptions(),
    supabase.from("categories").select("slug, name").eq("prohibited", false).order("sort_order"),
    listZonesForAdmin(),
  ]);
  const categoryList = categories.data ?? [];
  const currencyOf = new Map(options.currencies.map((c) => [c.code, c]));
  const tabHref = (value: string, closed = showClosed) =>
    `/admin/pricing?tab=${value}${closed ? "&closed=1" : ""}`;
  const now = new Date();

  return (
    <div className="mx-auto grid max-w-4xl gap-5 px-4 py-8">
      <div className="grid gap-1">
        <Link href="/admin" className="text-primary text-sm underline">
          Admin
        </Link>
        <h1 className="text-2xl font-bold">Pricing</h1>
        <p className="text-muted-foreground text-sm">
          Rates, fees and exchange rates behind every quote and estimate. Changing a rate closes the old rule
          and starts a new one, so quotes already sent can always be reproduced. Every change is logged.
        </p>
      </div>

      <nav aria-label="Pricing sections" className="flex flex-wrap gap-2">
        {TABS.map((item) => (
          <Link
            key={item.value}
            href={tabHref(item.value)}
            aria-current={item.value === tab ? "page" : undefined}
            className={cn(
              "inline-flex h-9 items-center rounded-full border px-3 text-sm",
              item.value === tab ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent",
            )}
          >
            {item.label}
          </Link>
        ))}
      </nav>

      {tab === "fees" || tab === "duty" ? (
        <p className="text-sm">
          <Link href={tabHref(tab, !showClosed)} className="text-primary underline">
            {showClosed ? "Hide closed rules" : "Show closed rules (history)"}
          </Link>
        </p>
      ) : null}

      {tab === "fees" ? (
        <FeesTab
          showClosed={showClosed}
          options={options}
          categories={categoryList}
          zones={zones}
          currencyOf={currencyOf}
        />
      ) : null}
      {tab === "duty" ? (
        <DutyTab showClosed={showClosed} options={options} categories={categoryList} />
      ) : null}
      {tab === "zones" ? <ZonesTab zones={zones} states={options.states} /> : null}
      {tab === "fx" ? <FxTab options={options} now={now} /> : null}

      <Card>
        <CardHeader>
          <CardTitle>Test calculation</CardTitle>
          <CardDescription>
            See what the engine gives for any item, route and destination, using the live rules and rates.
            Nothing is saved.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <TestCalculation
            currencies={options.currencies}
            corridors={options.corridors}
            categoryGroups={options.categoryGroups}
            states={options.states}
          />
        </CardContent>
      </Card>
    </div>
  );
}

type Options = Awaited<ReturnType<typeof loadCalcOptions>>;

async function FeesTab({
  showClosed,
  options,
  categories,
  zones,
  currencyOf,
}: {
  showClosed: boolean;
  options: Options;
  categories: { slug: string; name: string }[];
  zones: { id: string; name: string }[];
  currencyOf: Map<string, Options["currencies"][number]>;
}) {
  const rules = await listFeeRulesForAdmin(showClosed);
  const nameOf = (slug: string | null) => categories.find((c) => c.slug === slug)?.name;
  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Add a rule</CardTitle>
          <CardDescription>
            For a rate that does not exist yet. To change a rate that does, use Change on that rule. Two rules
            for the same fee cannot cover the same weight and time.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FeeRuleForm
            mode="create"
            corridors={options.corridors}
            categories={categories}
            zones={zones}
            currencies={options.currencies}
          />
        </CardContent>
      </Card>

      {rules.length === 0 ? (
        <p className="text-muted-foreground rounded-lg border border-dashed px-4 py-8 text-center text-sm">
          No rules.
        </p>
      ) : (
        <ul className="grid gap-3">
          {rules.map((rule) => {
            const currency = currencyOf.get(rule.currency);
            const digits = currency?.minor_unit_digits ?? 2;
            const closed = rule.effective_to !== null;
            const bound = (minor: number | null) =>
              minor === null ? "" : minorToDecimalString(minor, digits);
            return (
              <li key={rule.id} className={cn("grid gap-2 rounded-xl border p-4", closed && "opacity-70")}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium">
                    {FEE_TYPE_LABELS[rule.fee_type]}{" "}
                    <span className="text-muted-foreground font-normal">· {rule.corridor?.name}</span>
                  </p>
                  {closed ? <Badge variant="outline">Closed</Badge> : <Badge>In force</Badge>}
                </div>
                <p className="text-sm">
                  {formatRuleValue(rule, currency)}
                  {rule.min_amount_minor !== null && currency
                    ? `, minimum ${bound(rule.min_amount_minor)}`
                    : ""}
                  {rule.max_amount_minor !== null && currency
                    ? `, maximum ${bound(rule.max_amount_minor)}`
                    : ""}
                </p>
                <p className="text-muted-foreground text-xs">
                  {formatBand(rule.weight_from_g, rule.weight_to_g)}
                  {rule.zone ? ` · ${rule.zone.name}` : ""}
                  {rule.category_slug ? ` · only ${nameOf(rule.category_slug) ?? rule.category_slug}` : ""} ·
                  from {formatDateTime(rule.effective_from)}
                  {rule.effective_to ? ` to ${formatDateTime(rule.effective_to)}` : ""}
                </p>
                {rule.notes ? (
                  <p className="text-muted-foreground text-xs break-words">{rule.notes}</p>
                ) : null}
                {!closed ? (
                  <div className="flex flex-wrap items-start gap-2">
                    <details className="min-w-0 flex-1">
                      <summary className="text-primary cursor-pointer text-sm underline">Change rate</summary>
                      <div className="pt-3">
                        <FeeRuleForm
                          mode="change"
                          ruleId={rule.id}
                          currencies={options.currencies}
                          initial={{
                            calcMethod: rule.calc_method,
                            value:
                              rule.calc_method === "percent"
                                ? String(rule.value)
                                : minorToDecimalString(rule.value, digits),
                            currency: rule.currency,
                            minAmount: bound(rule.min_amount_minor),
                            maxAmount: bound(rule.max_amount_minor),
                            weightFromG: rule.weight_from_g === null ? "" : String(rule.weight_from_g),
                            weightToG: rule.weight_to_g === null ? "" : String(rule.weight_to_g),
                            notes: rule.notes ?? "",
                          }}
                        />
                      </div>
                    </details>
                    <CloseRuleButton kind="fee" id={rule.id} />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

async function DutyTab({
  showClosed,
  options,
  categories,
}: {
  showClosed: boolean;
  options: Options;
  categories: { slug: string; name: string }[];
}) {
  const rates = await listDutyRatesForAdmin(showClosed);
  const nameOf = (slug: string | null) =>
    slug ? (categories.find((c) => c.slug === slug)?.name ?? slug) : "All categories";
  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Add a duty rate</CardTitle>
          <CardDescription>
            Customs rates are placeholders until a licensed customs broker confirms them. A category rate
            beats the all-categories rate, and a parent category (Electronics) covers its children (Phones).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DutyRateForm mode="create" corridors={options.corridors} categories={categories} />
        </CardContent>
      </Card>
      <ul className="grid gap-3">
        {rates.map((rate) => {
          const closed = rate.effective_to !== null;
          return (
            <li key={rate.id} className={cn("grid gap-2 rounded-xl border p-4", closed && "opacity-70")}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium">
                  {nameOf(rate.category_slug)}{" "}
                  <span className="text-muted-foreground font-normal">· {rate.corridor?.name}</span>
                </p>
                {closed ? <Badge variant="outline">Closed</Badge> : <Badge>In force</Badge>}
              </div>
              <p className="text-sm">
                Duty {rate.import_duty_percent}%, other levies {rate.other_levies_percent}%, VAT{" "}
                {rate.vat_percent}%
              </p>
              <p className="text-muted-foreground text-xs">
                From {formatDateTime(rate.effective_from)}
                {rate.effective_to ? ` to ${formatDateTime(rate.effective_to)}` : ""}
              </p>
              {rate.notes ? <p className="text-muted-foreground text-xs break-words">{rate.notes}</p> : null}
              {!closed ? (
                <div className="flex flex-wrap items-start gap-2">
                  <details className="min-w-0 flex-1">
                    <summary className="text-primary cursor-pointer text-sm underline">Change rate</summary>
                    <div className="pt-3">
                      <DutyRateForm
                        mode="change"
                        ruleId={rate.id}
                        initial={{
                          importDutyPercent: String(rate.import_duty_percent),
                          vatPercent: String(rate.vat_percent),
                          otherLeviesPercent: String(rate.other_levies_percent),
                          notes: rate.notes ?? "",
                        }}
                      />
                    </div>
                  </details>
                  <CloseRuleButton kind="duty" id={rate.id} />
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ZonesTab({
  zones,
  states,
}: {
  zones: { id: string; name: string; states: string[] }[];
  states: string[];
}) {
  const holder: Record<string, string> = {};
  for (const zone of zones) for (const state of zone.states) holder[state] = zone.name;
  const takenExcept = (zoneName: string | null) =>
    Object.fromEntries(Object.entries(holder).filter(([, name]) => name !== zoneName));
  return (
    <div className="grid gap-4">
      <p className="text-muted-foreground text-sm">
        A state belongs to one zone. Last-mile delivery fees are set per zone. A state in no zone cannot be
        priced. Zones are edited in place; quotes keep their own copy.
      </p>
      {zones.map((zone) => (
        <Card key={zone.id}>
          <CardHeader>
            <CardTitle>{zone.name}</CardTitle>
            <CardDescription>{zone.states.join(", ")}</CardDescription>
          </CardHeader>
          <CardContent>
            <details>
              <summary className="text-primary cursor-pointer text-sm underline">Edit this zone</summary>
              <div className="pt-3">
                <ZoneForm
                  zoneId={zone.id}
                  initialName={zone.name}
                  initialStates={zone.states}
                  allStates={states}
                  takenBy={takenExcept(zone.name)}
                />
              </div>
            </details>
          </CardContent>
        </Card>
      ))}
      <Card>
        <CardHeader>
          <CardTitle>Add a zone</CardTitle>
        </CardHeader>
        <CardContent>
          <ZoneForm initialName="" initialStates={[]} allStates={states} takenBy={holder} />
        </CardContent>
      </Card>
    </div>
  );
}

async function FxTab({ options, now }: { options: Options; now: Date }) {
  const status = await listFxStatus(
    options.currencies.map((c) => c.code),
    now,
  );
  return (
    <div className="grid gap-4">
      <p className="text-muted-foreground text-sm">
        Rates are fetched every 6 hours. A fetched rate older than 24 hours with no override stops quotes and
        estimates in that currency; they show &quot;Delivered price on request&quot; until fresh rates arrive
        or you set an override. Rates by{" "}
        <a
          href="https://www.exchangerate-api.com"
          className="text-primary underline"
          rel="noopener noreferrer"
          target="_blank"
        >
          Exchange Rate API
        </a>
        .
      </p>
      {status.map((pair) => (
        <Card key={pair.quote}>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2">
              1 USD = {pair.row ? Number(pair.row.rate) : "no rate"} {pair.quote}
              {pair.row?.isOverride ? <Badge>Override</Badge> : null}
              {pair.stale ? (
                <Badge className="border-destructive/40 bg-destructive/10 text-destructive">Stale</Badge>
              ) : null}
            </CardTitle>
            <CardDescription className={pair.stale ? "text-destructive" : undefined}>
              {pair.row
                ? `${pair.row.source}, ${formatAge(pair.row.fetchedAt, now)}${pair.stale ? ". Quotes in this currency are refused." : ""}`
                : "Fetch rates, or set an override."}
              {pair.row ? ` · conversion fee ${Number(pair.row.spreadPercent)}%` : ""}
              {pair.row?.isOverride && pair.fetchedRate
                ? ` · fetched rate ${Number(pair.fetchedRate.rate)} (${formatAge(pair.fetchedRate.fetchedAt, now)})`
                : ""}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FxRowActions
              quote={pair.quote}
              hasOverride={pair.row?.isOverride ?? false}
              spread={pair.row ? String(Number(pair.row.spreadPercent)) : "0"}
            />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
