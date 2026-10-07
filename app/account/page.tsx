import type { Metadata } from "next";
import Link from "next/link";
import { ProfileForm } from "@/components/account/profile-form";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ROLE_LABELS, VENDOR_STATUS_LABELS } from "@/lib/auth/roles";
import { requireUser } from "@/lib/auth/session";
import { getProfile } from "@/lib/profile/queries";
import { listActiveCountries, listActiveCurrencies } from "@/lib/reference/queries";
import { getOwnVendor } from "@/lib/vendors/queries";

export const metadata: Metadata = { title: "Your account" };

export default async function AccountPage({ searchParams }: PageProps<"/account">) {
  const user = await requireUser("/account");
  const [{ applied }, profile, vendor, countries, currencies] = await Promise.all([
    searchParams,
    getProfile(user.id),
    getOwnVendor(user.id),
    listActiveCountries(),
    listActiveCurrencies(),
  ]);
  if (!profile) throw new Error("Profile not found for signed-in user.");

  return (
    <div className="mx-auto grid max-w-xl gap-6 px-4 py-8">
      {applied === "1" ? (
        <Alert variant="success">Application sent. We will email you once it has been reviewed.</Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Your account</CardTitle>
          <CardDescription className="break-all">{profile.email}</CardDescription>
        </CardHeader>
        <CardContent className="flex items-center gap-2">
          <span className="text-muted-foreground text-sm">Role:</span>
          <Badge variant="secondary">{ROLE_LABELS[user.role]}</Badge>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
        </CardHeader>
        <CardContent>
          <ProfileForm profile={profile} countries={countries} currencies={currencies} />
        </CardContent>
      </Card>

      {user.role !== "admin" ? (
        <Card>
          <CardHeader>
            <CardTitle>Sell on the platform</CardTitle>
            {vendor ? (
              <CardDescription>
                {vendor.business_name}: <strong>{VENDOR_STATUS_LABELS[vendor.status]}</strong>
              </CardDescription>
            ) : (
              <CardDescription>List your products for buyers in Nigeria and abroad.</CardDescription>
            )}
          </CardHeader>
          <CardContent className="grid gap-3">
            {vendor?.status === "pending" ? (
              <p className="text-muted-foreground text-sm">
                We are reviewing your application. You will be able to list products once it is approved.
              </p>
            ) : null}
            {vendor?.status === "rejected" || vendor?.status === "suspended" ? (
              <Alert variant="destructive">
                <p className="font-medium">
                  {vendor.status === "rejected"
                    ? "Your application was not approved."
                    : "Your vendor account is suspended."}
                </p>
                {vendor.verification_notes ? <p className="mt-1">{vendor.verification_notes}</p> : null}
              </Alert>
            ) : null}
            <div className="flex flex-wrap gap-2">
              {vendor?.status === "approved" ? (
                <>
                  <Link href="/vendor/products" className={buttonVariants()}>
                    Manage products
                  </Link>
                  <Link href={`/vendors/${vendor.id}`} className={buttonVariants({ variant: "outline" })}>
                    View your public page
                  </Link>
                </>
              ) : null}
              {vendor?.status === "rejected" ? (
                <Link href="/account/become-vendor" className={buttonVariants({ variant: "outline" })}>
                  Update and apply again
                </Link>
              ) : null}
              {!vendor ? (
                <Link href="/account/become-vendor" className={buttonVariants({ variant: "outline" })}>
                  Become a vendor
                </Link>
              ) : null}
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Orders and recipients</CardTitle>
          <CardDescription>Buy from any store, delivered to people in Nigeria.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Link href="/order/link" className={buttonVariants()}>
            Buy it for me
          </Link>
          <Link href="/account/orders" className={buttonVariants({ variant: "outline" })}>
            Your orders
          </Link>
          <Link href="/account/recipients" className={buttonVariants({ variant: "outline" })}>
            Recipients
          </Link>
        </CardContent>
      </Card>

      <Link href="/account/password" className="text-primary text-sm underline">
        Change password
      </Link>
    </div>
  );
}
