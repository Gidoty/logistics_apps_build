import type { Metadata } from "next";
import Link from "next/link";
import { RecipientRowActions } from "@/components/recipients/recipient-row-actions";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { requireUser } from "@/lib/auth/session";
import { listOwnRecipients } from "@/lib/recipients/queries";

export const metadata: Metadata = { title: "Recipients" };

export default async function RecipientsPage({ searchParams }: PageProps<"/account/recipients">) {
  await requireUser("/account/recipients");
  const [{ saved }, recipients] = await Promise.all([
    searchParams,
    listOwnRecipients({ includeArchived: true }),
  ]);

  return (
    <div className="mx-auto grid max-w-2xl gap-5 px-4 py-8">
      <div className="grid gap-1">
        <Link href="/account" className="text-primary text-sm underline">
          Your account
        </Link>
        <h1 className="text-2xl font-bold">Recipients</h1>
        <p className="text-muted-foreground text-sm">
          People who receive your orders in Nigeria. Save them once and pick them when you order.
        </p>
      </div>

      {saved === "1" ? <Alert variant="success">Recipient saved.</Alert> : null}

      <div>
        <Link href="/account/recipients/new" className={buttonVariants()}>
          Add a recipient
        </Link>
      </div>

      {recipients.length === 0 ? (
        <p className="text-muted-foreground rounded-lg border border-dashed px-4 py-10 text-center text-sm">
          No recipients yet.
        </p>
      ) : (
        <ul className="grid gap-3">
          {recipients.map((recipient) => (
            <li key={recipient.id} className="grid gap-3 rounded-xl border p-4">
              <div className="grid gap-1">
                <p className="flex flex-wrap items-center gap-2 font-medium">
                  {recipient.full_name}
                  {recipient.archived ? <Badge variant="outline">Archived</Badge> : null}
                </p>
                <p className="text-muted-foreground text-sm">{recipient.phone}</p>
                <p className="text-sm">
                  {recipient.address_line}, {recipient.city}, {recipient.state}
                </p>
                {recipient.landmark ? (
                  <p className="text-muted-foreground text-xs">Landmark: {recipient.landmark}</p>
                ) : null}
              </div>
              <RecipientRowActions id={recipient.id} archived={recipient.archived} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
