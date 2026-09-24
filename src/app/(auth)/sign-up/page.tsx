import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { GoogleSignInButton } from "@/components/auth/google-button";
import { SignUpForm } from "@/components/auth/sign-up-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getSessionUser } from "@/lib/auth/session";
import { isGoogleAuthEnabled } from "@/lib/env";
import { listActiveCountries } from "@/lib/reference/queries";

export const metadata: Metadata = { title: "Create account" };

export default async function SignUpPage() {
  if (await getSessionUser()) redirect("/account");
  const countries = await listActiveCountries();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Create your account</CardTitle>
        <CardDescription>
          Already have one? <Link href="/sign-in" className="text-primary underline">Sign in</Link>
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6">
        <SignUpForm countries={countries} />
        {isGoogleAuthEnabled() ? <GoogleSignInButton next="/account" /> : null}
      </CardContent>
    </Card>
  );
}
