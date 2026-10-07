import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { formatMoney, type CurrencyFormat } from "@/lib/money";
import type { CalcView } from "@/lib/pricing/view";

/** The lines of a calculation and their total. Used by the public estimator and the admin test panel. */
export function CalcResult({ view, currency }: { view: CalcView; currency: CurrencyFormat }) {
  return (
    <div className="grid gap-3">
      {view.warnings.map((warning) => (
        <Alert key={warning.code}>{warning.message}</Alert>
      ))}
      <dl className="grid gap-2 text-sm">
        {view.lines.map((line) => (
          <div key={line.calcType} className="flex items-start justify-between gap-3">
            <dt className="min-w-0 break-words">
              {line.label}
              {line.estimated ? (
                <Badge variant="outline" className="ml-2">
                  Estimated
                </Badge>
              ) : null}
            </dt>
            <dd className="shrink-0 tabular-nums">{formatMoney(line.amountMinor, currency)}</dd>
          </div>
        ))}
        <div className="flex items-center justify-between gap-3 border-t pt-2 text-base font-semibold">
          <dt>Total</dt>
          <dd className="tabular-nums">{formatMoney(view.totalMinor, currency, { withCode: true })}</dd>
        </div>
      </dl>
      <p className="text-muted-foreground text-xs">
        Charged on {view.chargeableWeightGrams} g (
        {view.weightBasis === "volumetric" ? "box size" : "actual weight"}).
      </p>
      {view.customsDisclaimer ? (
        <p className="text-muted-foreground text-xs">{view.customsDisclaimer}</p>
      ) : null}
    </div>
  );
}
