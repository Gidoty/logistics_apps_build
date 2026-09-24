import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { GoogleSignInButton } from "@/components/auth/google-button";
import { MagicLinkForm, PasswordSignInForm } from "@/components/auth/sign-in-forms";
import { Alert } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { safeRedirectPath } from "@/lib/auth/redirect";
import { getSessionUser } from "@/lib/auth/session";
import { isGoogleAuthEnabled } from "@/lib/env";

export const metadata: Metadata = { title: "Sign in" };

const ERROR_MESSAGES: Record<string, string> = {
  link_invalid: "That link is invalid or has expired. Please request a new one.",
  google_failed: "Google sign-in did not work. Please try again or use your email.",
  google_disabled: "Google sign-in is not available yet. Please use your email.",
};

export default async function SignInPage({ searchParams }: PageProps<"/sign-in">) {
  const params = await searchParams;
  const next = safeRedirectPath(params.next);
  if (await getSessionUser()) redirect(next);

  const errorKey = typeof params.error === "string" ? params.error : "";
  const errorMessage = ERROR_MESSAGES[errorKey];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sign in</CardTitle>
        <CardDescription>
          New here? <Link href="/sign-up" className="text-primary underline">Create an account</Link>
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6">
        {errorMessage ? <Alert variant="destructive">{errorMessage}</Alert> : null}
        <PasswordSignInForm next={next} />
        <Link href="/forgot-password" className="text-sm text-primary underline">
          Forgot your password?
        </Link>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="h-px flex-1 bg-border" /> or <span className="h-px flex-1 bg-border" />
        </div>
        <MagicLinkForm next={next} />
        {isGoogleAuthEnabled() ? <GoogleSignInButton next={next} /> : null}
      </CardContent>
    </Card>
  );
}
