import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { VendorReviewForm } from "@/components/admin/vendor-review-form";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireAdmin } from "@/lib/auth/session";
import { VENDOR_STATUS_LABELS } from "@/lib/auth/roles";
import { isUuid } from "@/lib/catalog/shop-queries";
import { getVendorForAdmin } from "@/lib/vendors/queries";
import { VENDOR_DOCUMENT_LINK_SECONDS } from "@/lib/storage/vendor-documents";

export const metadata: Metadata = { title: "Admin: vendor" };

export default async function AdminVendorPage({ params }: PageProps<"/admin/vendors/[vendorId]">) {
  const { vendorId } = await params;
  await requireAdmin(`/admin/vendors/${vendorId}`);
  if (!isUuid(vendorId)) notFound();
  const vendor = await getVendorForAdmin(vendorId);
  if (!vendor) notFound();

  const rows: [string, string][] = [
    [
      "Owner",
      vendor.owner
        ? `${vendor.owner.full_name || "No name"} (${vendor.owner.email ?? "no email"})`
        : "Unknown",
    ],
    ["Phone", vendor.phone ?? "Not given"],
    ["Location", `${vendor.city}, ${vendor.country_code}`],
    ["Registration number", vendor.business_reg_number ?? "Not given"],
    ["Sells", vendor.categories.length > 0 ? vendor.categories.join(", ") : "Nothing chosen"],
    ["Applied", new Date(vendor.created_at).toLocaleString("en-GB", { timeZone: "UTC" }) + " UTC"],
  ];

  return (
    <div className="mx-auto grid max-w-2xl gap-5 px-4 py-8">
      <div className="grid gap-1">
        <Link href="/admin/vendors" className="text-primary text-sm underline">
          All vendors
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold">{vendor.business_name}</h1>
          <Badge variant={vendor.status === "approved" ? "default" : "secondary"}>
            {VENDOR_STATUS_LABELS[vendor.status]}
          </Badge>
        </div>
      </div>

      {vendor.verification_notes && (vendor.status === "rejected" || vendor.status === "suspended") ? (
        <Alert variant="destructive">
          <p className="font-medium">Reason given to the vendor</p>
          <p className="mt-1 whitespace-pre-line">{vendor.verification_notes}</p>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Application</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-3 text-sm">
            {rows.map(([label, value]) => (
              <div key={label} className="grid gap-0.5 sm:grid-cols-[10rem_1fr]">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="font-medium break-words">{value}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>ID document</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm">
          {vendor.id_document_path ? (
            <>
              {/* A fresh short-lived link is made on every click, and each view is logged. */}
              <a
                href={`/admin/vendors/${vendor.id}/document`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary font-medium underline"
              >
                Open ID document
              </a>
              <p className="text-muted-foreground text-xs">
                The link works for {VENDOR_DOCUMENT_LINK_SECONDS} seconds and opening it is recorded in the
                audit log.
              </p>
            </>
          ) : (
            <p className="text-muted-foreground">
              No document uploaded. This application cannot be approved.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Decision</CardTitle>
        </CardHeader>
        <CardContent>
          <VendorReviewForm vendorId={vendor.id} status={vendor.status} />
        </CardContent>
      </Card>
    </div>
  );
}
