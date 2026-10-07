import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { RecipientForm } from "@/components/recipients/recipient-form";
import { requireUser } from "@/lib/auth/session";
import { isUuid } from "@/lib/catalog/shop-queries";
import { getOwnRecipient, listRegionNames } from "@/lib/recipients/queries";

export const metadata: Metadata = { title: "Edit recipient" };

export default async function EditRecipientPage({ params }: PageProps<"/account/recipients/[recipientId]">) {
  const { recipientId } = await params;
  await requireUser(`/account/recipients/${recipientId}`);
  if (!isUuid(recipientId)) notFound();

  const [recipient, states] = await Promise.all([getOwnRecipient(recipientId), listRegionNames("NG")]);
  if (!recipient) notFound();

  return (
    <div className="mx-auto grid max-w-xl gap-5 px-4 py-8">
      <div className="grid gap-1">
        <Link href="/account/recipients" className="text-primary text-sm underline">
          Recipients
        </Link>
        <h1 className="text-2xl font-bold">Edit recipient</h1>
      </div>
      <RecipientForm
        states={states}
        recipientId={recipient.id}
        lockAddress={recipient.inUse}
        defaults={{
          fullName: recipient.full_name,
          phone: recipient.phone,
          email: recipient.email ?? "",
          addressLine: recipient.address_line,
          city: recipient.city,
          state: recipient.state,
          landmark: recipient.landmark ?? "",
        }}
      />
    </div>
  );
}
