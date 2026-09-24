"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/forms/form-parts";
import { changeRole } from "@/lib/admin/actions";
import { ROLE_LABELS, type AppRole } from "@/lib/auth/roles";
import { initialFormState } from "@/lib/form-state";

type Props = { userId: string; role: AppRole; hasRole: boolean };

export function RoleToggle({ userId, role, hasRole }: Props) {
  const [state, action] = useActionState(changeRole, initialFormState);
  const label = ROLE_LABELS[role];

  return (
    <form action={action} className="inline-flex flex-col gap-1">
      <input type="hidden" name="userId" value={userId} />
      <input type="hidden" name="role" value={role} />
      <input type="hidden" name="intent" value={hasRole ? "revoke" : "grant"} />
      <SubmitButton size="sm" variant={hasRole ? "default" : "outline"} pendingLabel="..."
        aria-pressed={hasRole} title={hasRole ? `Remove ${label} role` : `Give ${label} role`}>
        {hasRole ? `${label} ✓` : `+ ${label}`}
      </SubmitButton>
      {state.status === "error" && state.message ? (
        <span role="alert" className="max-w-40 text-xs text-destructive">{state.message}</span>
      ) : null}
    </form>
  );
}
