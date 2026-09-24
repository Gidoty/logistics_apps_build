import type { Metadata } from "next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireApprovedVendor } from "@/lib/auth/session";
import { getOwnVendor } from "@/lib/vendors/queries";

export const metadata: Metadata = { title: "Vendor" };

export default async function VendorPage() {
  const user = await requireApprovedVendor("/vendor");
  const vendor = await getOwnVendor(user.id);

  return (
    <div className="mx-auto grid max-w-3xl gap-6 px-4 py-8">
      <Card>
        <CardHeader>
          <CardTitle>{vendor?.business_name ?? "Vendor"}</CardTitle>
          <CardDescription>{vendor ? `${vendor.city}, ${vendor.country_code}` : null}</CardDescription>
        </CardHeader>
        <CardContent className="text-muted-foreground text-sm">
          Your vendor dashboard (listings, orders, inspection uploads and payouts) arrives in a later batch.
        </CardContent>
      </Card>
    </div>
  );
}
