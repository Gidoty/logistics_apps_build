"use client";

import { useActionState } from "react";
import { FormMessage, SubmitButton } from "@/components/forms/form-parts";
import { clearProductFlag } from "@/lib/catalog/actions";
import { initialFormState } from "@/lib/form-state";

export function ClearFlagForm({ productId }: { productId: string }) {
  const [state, action] = useActionState(clearProductFlag, initialFormState);
  return (
    <form action={action} className="grid gap-2">
      <input type="hidden" name="productId" value={productId} />
      {state.status === "error" ? <FormMessage state={state} /> : null}
      <SubmitButton size="sm" variant="outline" pendingLabel="Clearing...">
        Clear flag
      </SubmitButton>
    </form>
  );
}
