import type { Metadata } from "next";
import Link from "next/link";
import { RecipientForm } from "@/components/recipients/recipient-form";
import { requireUser } from "@/lib/auth/session";
import { listRegionNames } from "@/lib/recipients/queries";

export const metadata: Metadata = { title: "Add recipient" };

export default async function NewRecipientPage() {
  await requireUser("/account/recipients/new");
  const states = await listRegionNames("NG");

  return (
    <div className="mx-auto grid max-w-xl gap-5 px-4 py-8">
      <div className="grid gap-1">
        <Link href="/account/recipients" className="text-primary text-sm underline">
          Recipients
        </Link>
        <h1 className="text-2xl font-bold">Add a recipient</h1>
      </div>
      <RecipientForm states={states} />
    </div>
  );
}
