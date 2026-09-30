import type { Metadata } from "next";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
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
        <CardContent className="flex flex-wrap gap-2">
          <Link href="/vendor/products" className={buttonVariants()}>
            Manage products
          </Link>
          {vendor ? (
            <Link href={`/vendors/${vendor.id}`} className={buttonVariants({ variant: "outline" })}>
              View your public page
            </Link>
          ) : null}
        </CardContent>
      </Card>
      <p className="text-muted-foreground text-sm">
        Orders, inspection uploads and payouts arrive in later batches.
      </p>
    </div>
  );
}
