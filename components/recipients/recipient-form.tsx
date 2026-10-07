"use client";

import Link from "next/link";
import { FormMessage } from "@/components/forms/form-parts";
import { useServerForm } from "@/components/forms/use-server-form";
import { Button, buttonVariants } from "@/components/ui/button";
import { saveRecipient } from "@/lib/recipients/actions";
import { RecipientFields, type RecipientDefaults } from "./recipient-fields";

type Props = { states: string[]; recipientId?: string; defaults?: RecipientDefaults; lockAddress?: boolean };

export function RecipientForm({ states, recipientId, defaults, lockAddress }: Props) {
  const { state, pending, onSubmit } = useServerForm(saveRecipient);
  return (
    <form onSubmit={onSubmit} className="grid gap-5" noValidate>
      <FormMessage state={state} />
      {recipientId ? <input type="hidden" name="id" value={recipientId} /> : null}
      <RecipientFields
        states={states}
        errors={state.fieldErrors}
        defaults={defaults}
        lockAddress={lockAddress}
      />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending} aria-busy={pending}>
          {pending ? "Saving..." : recipientId ? "Save changes" : "Add recipient"}
        </Button>
        <Link href="/account/recipients" className={buttonVariants({ variant: "outline" })}>
          Cancel
        </Link>
      </div>
    </form>
  );
}
