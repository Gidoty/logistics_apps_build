import type { Metadata } from "next";
import Link from "next/link";
import { ProfileForm } from "@/components/account/profile-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ROLE_LABELS } from "@/lib/auth/roles";
import { requireUser } from "@/lib/auth/session";
import { getProfile } from "@/lib/profile/queries";
import { listActiveCountries, listActiveCurrencies } from "@/lib/reference/queries";

export const metadata: Metadata = { title: "Your account" };

export default async function AccountPage() {
  const user = await requireUser("/account");
  const [profile, countries, currencies] = await Promise.all([
    getProfile(user.id),
    listActiveCountries(),
    listActiveCurrencies(),
  ]);
  if (!profile) throw new Error("Profile not found for signed-in user.");

  return (
    <div className="mx-auto grid max-w-xl gap-6 px-4 py-8">
      <Card>
        <CardHeader>
          <CardTitle>Your account</CardTitle>
          <CardDescription>{profile.email}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">Roles:</span>
          {user.roles.map((role) => (
            <Badge key={role} variant="secondary">{ROLE_LABELS[role]}</Badge>
          ))}
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
      <Link href="/account/password" className="text-sm text-primary underline">Change password</Link>
    </div>
  );
}
