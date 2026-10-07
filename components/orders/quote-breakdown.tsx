import { formatMoney, type CurrencyFormat } from "@/lib/money";
import { QUOTE_LINE_LABELS, type QuoteLineType } from "@/lib/orders/quote-lines";

type Line = { id: string; line_type: string; label: string; amount_minor: number };

type Props = { lines: Line[]; totalMinor: number; currency: CurrencyFormat };

/** The quote lines and the total. Every amount is stored in minor units and formatted here. */
export function QuoteBreakdown({ lines, totalMinor, currency }: Props) {
  return (
    <dl className="grid gap-2 text-sm">
      {lines.map((line) => (
        <div key={line.id} className="flex items-start justify-between gap-3">
          <dt className="min-w-0">
            <span className="break-words">{line.label}</span>
            <span className="text-muted-foreground block text-xs">
              {QUOTE_LINE_LABELS[line.line_type as QuoteLineType] ?? line.line_type}
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
  );
}
