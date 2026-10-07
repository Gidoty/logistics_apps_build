import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { requireAdmin } from "@/lib/auth/session";
import { formatAge, isOverdue } from "@/lib/orders/format";
import { listQuoteQueue, readStoredPreview } from "@/lib/orders/queries";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Admin: quote requests" };

const FILTERS = [
  { value: "all", label: "All" },
  { value: "unknown", label: "Unknown store" },
  { value: "unread", label: "Unread message" },
] as const;

export default async function AdminQuotesPage({ searchParams }: PageProps<"/admin/quotes">) {
  await requireAdmin("/admin/quotes");
  const requested = (await searchParams).filter;
  const filter = FILTERS.find((item) => item.value === requested)?.value ?? "all";
  const rows = await listQuoteQueue({ unknownStore: filter === "unknown", unreadOnly: filter === "unread" });
  const now = new Date();

  return (
    <div className="mx-auto grid max-w-3xl gap-5 px-4 py-8">
      <div className="grid gap-1">
        <Link href="/admin" className="text-primary text-sm underline">
          Admin
        </Link>
        <h1 className="text-2xl font-bold">Quote requests</h1>
        <p className="text-muted-foreground text-sm">
          Oldest first. Requests older than 24 hours are in red.
        </p>
      </div>

      <nav aria-label="Filter requests" className="flex flex-wrap gap-2">
        {FILTERS.map((item) => {
          const active = item.value === filter;
          return (
            <Link
              key={item.value}
              href={item.value === "all" ? "/admin/quotes" : `/admin/quotes?filter=${item.value}`}
              aria-current={active ? "page" : undefined}
              className={cn(
                "inline-flex h-9 items-center rounded-full border px-3 text-sm",
                active ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent",
              )}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>

      {rows.length === 0 ? (
        <p className="text-muted-foreground rounded-lg border border-dashed px-4 py-10 text-center text-sm">
          No requests waiting.
        </p>
      ) : (
        <ul className="grid gap-3">
          {rows.map((row) => {
            const overdue = isOverdue(row.created_at, now);
            const title = readStoredPreview(row.link_preview_json)?.title;
            return (
              <li key={row.id}>
                <Link
                  href={`/admin/quotes/${row.id}`}
                  className="hover:bg-accent focus-visible:ring-ring/50 grid gap-1 rounded-xl border p-4 outline-none focus-visible:ring-[3px]"
                >
                  <span className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium break-words">
                      {title ?? row.store?.display_name ?? row.source_host ?? "Link order"}
                    </span>
                    <span className={cn("text-sm", overdue && "text-destructive font-semibold")}>
                      {formatAge(row.created_at, now)}
                    </span>
                  </span>
                  <span className="text-muted-foreground text-sm">
                    {row.buyer?.full_name || row.buyer?.email || "Buyer"} · {row.source_host}
                    {row.recipient ? ` · to ${row.recipient.city}, ${row.recipient.state}` : ""}
                  </span>
                  <span className="flex flex-wrap gap-2">
                    {row.store_domain_id === null ? <Badge variant="outline">Unknown store</Badge> : null}
                    {row.unreadFromBuyer ? <Badge>New message</Badge> : null}
                    {overdue ? (
                      <Badge className="border-destructive/40 bg-destructive/10 text-destructive">
                        Over 24 hours
                      </Badge>
                    ) : null}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
