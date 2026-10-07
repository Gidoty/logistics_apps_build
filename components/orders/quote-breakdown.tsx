import { formatMoney, type CurrencyFormat } from "@/lib/money";
import { ESTIMATED_LINE_TYPES, QUOTE_LINE_LABELS, type QuoteLineType } from "@/lib/orders/quote-lines";
import { CUSTOMS_DISCLAIMER } from "@/lib/pricing/types";

type Line = { id: string; line_type: string; label: string; amount_minor: number };

type Props = { lines: Line[]; totalMinor: number; currency: CurrencyFormat };

const isEstimate = (type: string) => (ESTIMATED_LINE_TYPES as readonly string[]).includes(type);

/** The quote lines and the total. Every amount is stored in minor units and formatted here. */
export function QuoteBreakdown({ lines, totalMinor, currency }: Props) {
  const hasEstimates = lines.some((line) => isEstimate(line.line_type));
  return (
    <div className="grid gap-2">
      <dl className="grid gap-2 text-sm">
        {lines.map((line) => (
          <div key={line.id} className="flex items-start justify-between gap-3">
            <dt className="min-w-0">
              <span className="break-words">{line.label}</span>
              <span className="text-muted-foreground block text-xs">
                {QUOTE_LINE_LABELS[line.line_type as QuoteLineType] ?? line.line_type}
                {isEstimate(line.line_type) ? " · Estimated" : ""}
              </span>
            </dt>
            <dd className="shrink-0 tabular-nums">{formatMoney(line.amount_minor, currency)}</dd>
          </div>
        ))}
        <div className="flex items-center justify-between gap-3 border-t pt-2 text-base font-semibold">
          <dt>Total</dt>
          <dd className="tabular-nums">{formatMoney(totalMinor, currency, { withCode: true })}</dd>
        </div>
      </dl>
      {hasEstimates ? <p className="text-muted-foreground text-xs">{CUSTOMS_DISCLAIMER}</p> : null}
    </div>
  );
}
