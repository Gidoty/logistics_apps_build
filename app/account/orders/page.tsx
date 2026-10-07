import type { Metadata } from "next";
import Link from "next/link";
import { OrderStatusBadge } from "@/components/orders/order-status-badge";
import { buttonVariants } from "@/components/ui/button";
import { requireUser } from "@/lib/auth/session";
import { formatMoney } from "@/lib/money";
import { formatDateTime } from "@/lib/orders/format";
import { listOwnOrders, readStoredPreview } from "@/lib/orders/queries";
import { listActiveCurrencies } from "@/lib/reference/queries";

export const metadata: Metadata = { title: "Your orders" };

export default async function OrdersPage() {
  await requireUser("/account/orders");
  const [orders, currencies] = await Promise.all([listOwnOrders(), listActiveCurrencies()]);
  const currencyByCode = new Map(currencies.map((currency) => [currency.code, currency]));

  return (
    <div className="mx-auto grid max-w-2xl gap-5 px-4 py-8">
      <div className="grid gap-1">
        <Link href="/account" className="text-primary text-sm underline">
          Your account
        </Link>
        <h1 className="text-2xl font-bold">Your orders</h1>
      </div>
      <div>
        <Link href="/order/link" className={buttonVariants()}>
          Buy it for me
        </Link>
      </div>

      {orders.length === 0 ? (
        <p className="text-muted-foreground rounded-lg border border-dashed px-4 py-10 text-center text-sm">
          No orders yet. Paste a product link to get your first quote.
        </p>
      ) : (
        <ul className="grid gap-3">
          {orders.map((order) => {
            const title = readStoredPreview(order.link_preview_json)?.title;
            const quote = [...order.quotes].sort((a, b) => b.version - a.version)[0];
            const currency = quote ? currencyByCode.get(quote.currency) : undefined;
            return (
              <li key={order.id}>
                <Link
                  href={`/account/orders/${order.id}`}
                  className="hover:bg-accent focus-visible:ring-ring/50 grid gap-1 rounded-xl border p-4 outline-none focus-visible:ring-[3px]"
                >
                  <span className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium break-words">
                      {title ?? (order.source_host ? `Item from ${order.source_host}` : "Order")}
                    </span>
                    <OrderStatusBadge status={order.status} />
                  </span>
                  <span className="text-muted-foreground text-sm">
                    {order.recipient ? `To ${order.recipient.full_name}, ${order.recipient.city}` : null}
                    {" · "}
                    {formatDateTime(order.created_at)}
                  </span>
                  {quote && currency && order.status !== "quote_requested" ? (
                    <span className="text-sm font-medium">
                      {formatMoney(quote.total_minor, currency, { withCode: true })}
                    </span>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
