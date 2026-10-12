import type { Metadata } from "next";
import Link from "next/link";
import { OrderStatusBadge } from "@/components/orders/order-status-badge";
import { Badge } from "@/components/ui/badge";
import { requireAdmin } from "@/lib/auth/session";
import { formatAge } from "@/lib/orders/format";
import { listOrdersForAdmin } from "@/lib/orders/admin-orders";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Admin: orders" };

const FILTERS = [
  { value: "attention", label: "Needs attention" },
  { value: "all", label: "All orders" },
] as const;

export default async function AdminOrdersPage({ searchParams }: PageProps<"/admin/orders">) {
  await requireAdmin("/admin/orders");
  const requested = (await searchParams).filter;
  const filter = FILTERS.find((item) => item.value === requested)?.value ?? "attention";
  const orders = await listOrdersForAdmin(filter);

  return (
    <div className="mx-auto grid max-w-3xl gap-5 px-4 py-8">
      <div className="grid gap-1">
        <Link href="/admin" className="text-primary text-sm underline">
          Admin
        </Link>
        <h1 className="text-2xl font-bold">Orders</h1>
      </div>
      <nav aria-label="Filter orders" className="flex flex-wrap gap-2">
        {FILTERS.map((item) => (
          <Link
            key={item.value}
            href={`/admin/orders?filter=${item.value}`}
            aria-current={item.value === filter ? "page" : undefined}
            className={cn(
              "inline-flex h-9 items-center rounded-full border px-3 text-sm",
              item.value === filter ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent",
            )}
          >
            {item.label}
          </Link>
        ))}
      </nav>
      {orders.length === 0 ? (
        <p className="text-muted-foreground rounded-lg border border-dashed px-4 py-10 text-center text-sm">
          {filter === "attention" ? "Nothing needs attention." : "No orders yet."}
        </p>
      ) : (
        <ul className="grid gap-3">
          {orders.map((order) => (
            <li key={order.id}>
              <Link
                href={`/admin/orders/${order.id}`}
                className="hover:bg-accent focus-visible:ring-ring/50 grid gap-1 rounded-xl border p-4 outline-none focus-visible:ring-[3px]"
              >
                <span className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium break-words">{order.items[0]?.description ?? "Order"}</span>
                  <OrderStatusBadge status={order.status} />
                </span>
                <span className="text-muted-foreground text-sm">
                  {order.buyer?.full_name || order.buyer?.email || "Buyer"} ·{" "}
                  {order.order_type === "link" ? "Buy it for me" : "Shop"} · {formatAge(order.created_at)}
                </span>
                {order.review_flags.length > 0 ? (
                  <span className="flex flex-wrap gap-2">
                    {order.review_flags.map((flag) => (
                      <Badge key={flag} className="border-destructive/40 bg-destructive/10 text-destructive">
                        {flag.replaceAll("_", " ")}
                      </Badge>
                    ))}
                  </span>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
