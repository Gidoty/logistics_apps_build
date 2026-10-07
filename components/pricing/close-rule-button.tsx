"use client";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { closeDutyRate, closeFeeRule } from "@/lib/pricing/admin-actions";
import { useAdminAction } from "./use-admin-action";

/** Ends a rule now. It stays in the history; quotes already sent keep their own copy. */
export function CloseRuleButton({ kind, id }: { kind: "fee" | "duty"; id: string }) {
  const { pending, result, run } = useAdminAction();
  return (
    <div className="grid gap-1">
      {result && !result.ok ? <Alert variant="destructive">{result.message}</Alert> : null}
      <Button
        type="button"
        size="sm"
        variant="ghost"
        disabled={pending}
        onClick={() => {
          if (window.confirm("Close this rule? Orders priced after now will not use it.")) {
            run(() => (kind === "fee" ? closeFeeRule(id) : closeDutyRate(id)));
          }
        }}
      >
        Close
      </Button>
    </div>
  );
}
