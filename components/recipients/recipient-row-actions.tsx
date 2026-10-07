"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { deleteRecipient, setRecipientArchived } from "@/lib/recipients/actions";

export function RecipientRowActions({ id, archived }: { id: string; archived: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  function run(action: () => Promise<{ ok: boolean; message?: string }>) {
    setMessage(null);
    startTransition(async () => {
      const result = await action();
      if (result.message) setMessage({ ok: result.ok, text: result.message });
      router.refresh();
    });
  }

  return (
    <div className="grid gap-2">
      {message ? <Alert variant={message.ok ? "success" : "destructive"}>{message.text}</Alert> : null}
      <div className="flex flex-wrap gap-2">
        <Link
          href={`/account/recipients/${id}`}
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          Edit
        </Link>
        {archived ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => run(() => setRecipientArchived(id, false))}
          >
            Restore
          </Button>
        ) : null}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={() => {
            if (window.confirm("Delete this recipient?")) run(() => deleteRecipient(id));
          }}
        >
          Delete
        </Button>
      </div>
    </div>
  );
}
