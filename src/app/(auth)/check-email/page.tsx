import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "Check your email" };

export default async function CheckEmailPage({ searchParams }: PageProps<"/check-email">) {
  const { email } = await searchParams;
  const address = typeof email === "string" && email.length <= 254 ? email : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Check your email</CardTitle>
        <CardDescription>
          We sent a confirmation link{address ? <> to <strong>{address}</strong></> : null}. Open it on this
          device to finish creating your account.
        </CardDescription>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">
        No email after a few minutes? Check your spam folder, or{" "}
        <Link href="/sign-up" className="text-primary underline">try again</Link>.
      </CardContent>
    </Card>
  );
}
