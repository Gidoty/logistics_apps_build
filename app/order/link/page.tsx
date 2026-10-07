import type { Metadata } from "next";
import { LinkOrderForm } from "@/components/orders/link-order-form";
import { requireUser } from "@/lib/auth/session";
import { getProfile } from "@/lib/profile/queries";
import { listOwnRecipients, listRegionNames } from "@/lib/recipients/queries";
import { listActiveCurrencies } from "@/lib/reference/queries";

export const metadata: Metadata = { title: "Buy it for me" };

export default async function LinkOrderPage() {
  const user = await requireUser("/order/link");
  const [profile, recipients, states, currencies] = await Promise.all([
    getProfile(user.id),
    listOwnRecipients(),
    listRegionNames("NG"),
    listActiveCurrencies(),
  ]);

  return (
    <div className="mx-auto grid max-w-xl gap-5 px-4 py-8">
      <div className="grid gap-1">
        <h1 className="text-2xl font-bold">Buy it for me</h1>
        <p className="text-muted-foreground text-sm">
          Found something on AliExpress, Jumia or another store? Paste the link. We work out the full price,
          delivery to Nigeria included, and send you a quote.
        </p>
      </div>
      <LinkOrderForm
        recipients={recipients}
        states={states}
        currencies={currencies}
        defaultCurrency={profile?.preferred_currency ?? "NGN"}
      />
    </div>
  );
}
