import type { Metadata } from "next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireAdmin } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Admin" };

export default async function AdminPage() {
  const admin = await requireAdmin("/admin");

  return (
    <div className="mx-auto grid max-w-3xl gap-6 px-4 py-8">
      <Card>
        <CardHeader>
          <CardTitle>Admin</CardTitle>
          <CardDescription>Signed in as {admin.email}</CardDescription>
        </CardHeader>
        <CardContent className="text-muted-foreground text-sm">
          The admin dashboard (vendor approvals, quotes, fees, FX, shipments and disputes) arrives in Batch 8.
        </CardContent>
      </Card>
    </div>
  );
}
