import { formatMoney } from "@/lib/money";
import { PRICE_ON_REQUEST } from "@/lib/pricing/public-errors";
import type { ShopEstimate } from "@/lib/pricing/shop-estimate";
import type { CurrencyOption } from "@/lib/reference/queries";

/** "Est. delivered: ₦150,000.00", or "Delivered price on request" when there is no safe number to show. */
export function DeliveredEstimate({
  estimate,
  currencies,
  className,
}: {
  estimate: ShopEstimate;
  currencies: CurrencyOption[];
  className?: string;
}) {
  const currency = estimate.ok ? currencies.find((item) => item.code === estimate.currency) : undefined;
  if (!estimate.ok || !currency) {
    return <p className={className ?? "text-muted-foreground text-xs"}>{PRICE_ON_REQUEST}</p>;
  }
  return (
    <p className={className ?? "text-xs"}>
      <span className="text-muted-foreground">Est. delivered: </span>
      <span className="font-medium">{formatMoney(estimate.totalMinor, currency)}</span>
    </p>
  );
}
