"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { deleteProduct, setProductActive } from "@/lib/catalog/actions";

type Props = { productId: string; active: boolean; flagged: boolean; imageCount: number };

/** Publish, hide or delete a product. Hiding is preferred: delete only works for products never ordered. */
export function ProductStatusActions({ productId, active, flagged, imageCount }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const cannotPublish = flagged
    ? "Under review. An admin must clear it first."
    : imageCount === 0
      ? "Add at least one photo first."
      : null;

  function toggle(next: boolean) {
    setError(null);
    startTransition(async () => {
      const result = await setProductActive(productId, next);
      if (!result.ok) return setError(result.message);
      router.refresh();
    });
  }

  function remove() {
    if (!window.confirm("Delete this product? This cannot be undone.")) return;
    setError(null);
    startTransition(async () => {
      const result = await deleteProduct(productId);
      if (!result.ok) return setError(result.message);
      router.push(`/vendor/products?${result.outcome === "deleted" ? "deleted=1" : "hidden=1"}`);
      router.refresh();
    });
  }

  return (
    <div className="grid gap-3">
      {error ? <Alert variant="destructive">{error}</Alert> : null}
      <div className="flex flex-wrap gap-2">
        {active ? (
          <Button type="button" variant="outline" disabled={pending} onClick={() => toggle(false)}>
            Hide from shop
          </Button>
        ) : (
          <Button type="button" disabled={pending || cannotPublish !== null} onClick={() => toggle(true)}>
            Publish to shop
          </Button>
        )}
        <Button type="button" variant="ghost" disabled={pending} onClick={remove}>
          Delete
        </Button>
      </div>
      {!active && cannotPublish ? <p className="text-muted-foreground text-xs">{cannotPublish}</p> : null}
      <p className="text-muted-foreground text-xs">
        Products that were ordered cannot be deleted. They are hidden instead, so past orders stay complete.
      </p>
    </div>
  );
}
