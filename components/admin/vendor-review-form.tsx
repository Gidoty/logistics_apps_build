"use client";

import { useActionState } from "react";
import { FormMessage, SubmitButton } from "@/components/forms/form-parts";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { initialFormState } from "@/lib/form-state";
import { reviewVendor } from "@/lib/vendors/actions";
import type { Tables } from "@/lib/supabase/database.types";

type Props = { vendorId: string; status: Tables<"vendors">["status"] };

/**
 * Approve, reject or suspend. Reject and suspend need a reason, which the
 * vendor sees on their account page. Which buttons appear depends on the
 * status, matching the transitions the database allows.
 */
export function VendorReviewForm({ vendorId, status }: Props) {
  const [state, action] = useActionState(reviewVendor, initialFormState);
  const needsReason = status === "pending" || status === "approved";
  const reasonError = state.fieldErrors?.reason?.join(" ");

  if (status === "rejected") {
    return (
      <p className="text-muted-foreground text-sm">
        This application was rejected. The applicant can update it and send it again, and it will return to
        this list as pending.
      </p>
    );
  }

  return (
    <form action={action} className="grid gap-3" noValidate>
      <input type="hidden" name="vendorId" value={vendorId} />
      <FormMessage state={state} />

      {needsReason ? (
        <div className="grid gap-1.5">
          <Label htmlFor="reason">
            {status === "pending" ? "Reason (needed to reject)" : "Reason (needed to suspend)"}
          </Label>
          <Textarea
            id="reason"
            name="reason"
            maxLength={2000}
            aria-invalid={Boolean(reasonError)}
            aria-describedby={reasonError ? "reason-error" : "reason-hint"}
          />
          {reasonError ? (
            <p id="reason-error" className="text-destructive text-xs">
              {reasonError}
            </p>
          ) : (
            <p id="reason-hint" className="text-muted-foreground text-xs">
              The vendor will see this reason.
            </p>
          )}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {status === "pending" || status === "suspended" ? (
          <SubmitButton name="intent" value="approve" pendingLabel="Working...">
            {status === "suspended" ? "Reinstate vendor" : "Approve"}
          </SubmitButton>
        ) : null}
        {status === "pending" ? (
          <SubmitButton name="intent" value="reject" variant="destructive" pendingLabel="Working...">
            Reject
          </SubmitButton>
        ) : null}
        {status === "approved" ? (
          <SubmitButton name="intent" value="suspend" variant="destructive" pendingLabel="Working...">
            Suspend vendor
          </SubmitButton>
        ) : null}
      </div>
    </form>
  );
}
