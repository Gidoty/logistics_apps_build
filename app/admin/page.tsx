import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireAdmin } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Admin" };

const SECTIONS = [
  {
    href: "/admin/vendors",
    title: "Vendors",
    body: "Review applications, approve, reject or suspend vendors.",
  },
  {
    href: "/admin/products",
    title: "Flagged products",
    body: "Listings held because they contain words we review.",
  },
];

export default async function AdminPage() {
  const admin = await requireAdmin("/admin");

  return (
    <div className="mx-auto grid max-w-3xl gap-6 px-4 py-8">
      <div className="grid gap-1">
        <h1 className="text-2xl font-bold">Admin</h1>
        <p className="text-muted-foreground text-sm">Signed in as {admin.email}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {SECTIONS.map((section) => (
          <Link
            key={section.href}
            href={section.href}
            className="focus-visible:ring-ring/50 rounded-xl outline-none focus-visible:ring-[3px]"
          >
            <Card className="hover:bg-accent h-full gap-2 py-4 transition-colors">
              <CardHeader>
                <CardTitle>{section.title}</CardTitle>
                <CardDescription>{section.body}</CardDescription>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>
      <Card>
        <CardContent className="text-muted-foreground text-sm">
          The full admin dashboard (quotes, fees, exchange rates, shipments and disputes) arrives in Batch 8.
        </CardContent>
      </Card>
    </div>
  );
}
