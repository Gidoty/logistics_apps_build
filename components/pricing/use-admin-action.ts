"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { PricingAdminResult } from "@/lib/pricing/admin-actions";

/** Runs an admin pricing action, keeps its result for display, and refreshes the page when it worked. */
export function useAdminAction() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<PricingAdminResult | null>(null);

  function run(action: () => Promise<PricingAdminResult>, onDone?: () => void) {
    setResult(null);
    startTransition(async () => {
      const outcome = await action();
      setResult(outcome);
      if (outcome.ok) {
        onDone?.();
        router.refresh();
      }
    });
  }
  return { pending, result, run };
}

export function fieldError(result: PricingAdminResult | null, name: string): string | undefined {
  return result && !result.ok ? result.fieldErrors?.[name]?.join(" ") : undefined;
}
