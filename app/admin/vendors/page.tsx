import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { requireAdmin } from "@/lib/auth/session";
import { VENDOR_STATUS_LABELS } from "@/lib/auth/roles";
import { ADMIN_VENDOR_PAGE_SIZE, listVendorsForAdmin } from "@/lib/vendors/queries";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Admin: vendors" };

const FILTERS = [
  { value: null, label: "All" },
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "suspended", label: "Suspended" },
] as const;

type Status = "pending" | "approved" | "rejected" | "suspended";

export default async function AdminVendorsPage({ searchParams }: PageProps<"/admin/vendors">) {
  await requireAdmin("/admin/vendors");
  const requested = (await searchParams).status;
  const status = FILTERS.find((filter) => filter.value === requested)?.value ?? null;
  const vendors = await listVendorsForAdmin(status as Status | null);

  return (
    <div className="mx-auto grid max-w-3xl gap-5 px-4 py-8">
      <div className="grid gap-1">
        <Link href="/admin" className="text-primary text-sm underline">
          Admin
        </Link>
        <h1 className="text-2xl font-bold">Vendors</h1>
      </div>

      <nav aria-label="Filter by status" className="flex flex-wrap gap-2">
        {FILTERS.map((filter) => {
          const active = filter.value === status;
          return (
            <Link
              key={filter.label}
              href={filter.value ? `/admin/vendors?status=${filter.value}` : "/admin/vendors"}
              aria-current={active ? "page" : undefined}
              className={cn(
                "inline-flex h-9 items-center rounded-full border px-3 text-sm",
                active ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent",
              )}
            >
              {filter.label}
            </Link>
          );
        })}
      </nav>

      {vendors.length === 0 ? (
        <p className="text-muted-foreground rounded-lg border border-dashed px-4 py-10 text-center text-sm">
          No vendors{status ? ` with status "${status}"` : ""} yet.
        </p>
      ) : (
        <ul className="grid gap-3">
          {vendors.map((vendor) => (
            <li key={vendor.id}>
              <Link
                href={`/admin/vendors/${vendor.id}`}
                className="hover:bg-accent focus-visible:ring-ring/50 grid gap-1 rounded-lg border p-4 outline-none focus-visible:ring-[3px]"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{vendor.business_name}</span>
                  <Badge
                    variant={
                      vendor.status === "approved"
                        ? "default"
                        : vendor.status === "pending"
                          ? "secondary"
                          : "outline"
                    }
                  >
                    {VENDOR_STATUS_LABELS[vendor.status]}
                  </Badge>
                </div>
                <span className="text-muted-foreground text-sm">
                  {vendor.city}, {vendor.country_code} · {vendor.owner?.email ?? "no email"}
                </span>
                <span className="text-muted-foreground text-xs">
                  Applied {new Date(vendor.created_at).toLocaleDateString("en-GB", { timeZone: "UTC" })}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {vendors.length === ADMIN_VENDOR_PAGE_SIZE ? (
        <p className="text-muted-foreground text-xs">
          Showing the newest {ADMIN_VENDOR_PAGE_SIZE}. Use the filters to narrow the list.
        </p>
      ) : null}
    </div>
  );
}
