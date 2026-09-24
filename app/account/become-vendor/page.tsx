import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { VendorApplicationForm } from "@/components/vendors/vendor-application-form";
import { requireUser } from "@/lib/auth/session";
import { getProfile } from "@/lib/profile/queries";
import { listActiveCountries } from "@/lib/reference/queries";

export const metadata: Metadata = { title: "Become a vendor" };

export default async function BecomeVendorPage() {
  const user = await requireUser("/account/become-vendor");
  if (user.vendor || user.role === "admin") redirect("/account");

  const [profile, countries] = await Promise.all([getProfile(user.id), listActiveCountries()]);

  return (
    <div className="mx-auto max-w-md px-4 py-8">
      <Card>
        <CardHeader>
          <CardTitle>Become a vendor</CardTitle>
          <CardDescription>
            Tell us about your business. Our team reviews every application before you can list products.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <VendorApplicationForm countries={countries} defaultCountry={profile?.country_code ?? null} />
          <Link href="/account" className="text-primary text-sm underline">
            Back to your account
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
