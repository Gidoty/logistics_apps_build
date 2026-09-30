import type { Metadata } from "next";
import Link from "next/link";
import { ClearFlagForm } from "@/components/admin/clear-flag-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireAdmin } from "@/lib/auth/session";
import { listFlaggedProducts } from "@/lib/catalog/queries";

export const metadata: Metadata = { title: "Admin: flagged products" };

export default async function AdminFlaggedProductsPage() {
  await requireAdmin("/admin/products");
  const products = await listFlaggedProducts();

  return (
    <div className="mx-auto grid max-w-3xl gap-5 px-4 py-8">
      <div className="grid gap-1">
        <Link href="/admin" className="text-primary text-sm underline">
          Admin
        </Link>
        <h1 className="text-2xl font-bold">Flagged products</h1>
        <p className="text-muted-foreground text-sm">
          These listings contain words we review, and stay hidden until you clear them. Leave a flag in place
          to keep a listing hidden.
        </p>
      </div>

      {products.length === 0 ? (
        <p className="text-muted-foreground rounded-lg border border-dashed px-4 py-10 text-center text-sm">
          Nothing is waiting for review.
        </p>
      ) : (
        <ul className="grid gap-3">
          {products.map((product) => (
            <li key={product.id}>
              <Card className="gap-3 py-4">
                <CardHeader>
                  <CardTitle className="text-base">{product.title}</CardTitle>
                  <CardDescription>
                    {product.vendor ? product.vendor.business_name : "Unknown vendor"} · {product.category}
                    {product.brand ? ` · ${product.brand}` : ""}
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-3 text-sm">
                  <p className="text-destructive font-medium">{product.flagged_reason}</p>
                  <p className="text-muted-foreground line-clamp-4 whitespace-pre-line">
                    {product.description}
                  </p>
                  <ClearFlagForm productId={product.id} />
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
