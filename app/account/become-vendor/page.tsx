import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { VendorApplicationForm } from "@/components/vendors/vendor-application-form";
import { loadProductFormOptions } from "@/lib/catalog/context";
import { requireUser } from "@/lib/auth/session";
import { getProfile } from "@/lib/profile/queries";
import { listActiveCountries } from "@/lib/reference/queries";
import { createClient } from "@/lib/supabase/server";
import { getOwnVendor } from "@/lib/vendors/queries";

export const metadata: Metadata = { title: "Become a vendor" };

export default async function BecomeVendorPage() {
  const user = await requireUser("/account/become-vendor");
  if (user.role === "admin") redirect("/account");

  const vendor = await getOwnVendor(user.id);
  // Pending, approved and suspended applications cannot be edited. A rejected one can be sent again.
  if (vendor && vendor.status !== "rejected") redirect("/account");

  const supabase = await createClient();
  const [profile, countries, options] = await Promise.all([
    getProfile(user.id),
    listActiveCountries(),
    loadProductFormOptions(supabase, "NG"),
  ]);

  return (
    <div className="mx-auto max-w-md px-4 py-8">
      <Card>
        <CardHeader>
          <CardTitle>{vendor ? "Update your application" : "Become a vendor"}</CardTitle>
          <CardDescription>
            Tell us about your business. Our team reviews every application before you can list products.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {vendor?.verification_notes ? (
            <Alert variant="destructive">
              <p className="font-medium">Your last application was not approved.</p>
              <p className="mt-1">{vendor.verification_notes}</p>
            </Alert>
          ) : null}
          <VendorApplicationForm
            userId={user.id}
            countries={countries.map(({ code, name }) => ({ code, name }))}
            categoryGroups={options.categoryGroups}
            defaults={{
              businessName: vendor?.business_name ?? "",
              countryCode: vendor?.country_code ?? profile?.country_code ?? "",
              city: vendor?.city ?? "",
              phone: vendor?.phone ?? profile?.phone ?? "",
              businessRegNumber: vendor?.business_reg_number ?? "",
              categories: vendor?.categories ?? [],
            }}
            existingDocumentPath={vendor?.id_document_path ?? null}
            resubmitting={vendor !== null}
          />
          <Link href="/account" className="text-primary text-sm underline">
            Back to your account
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
