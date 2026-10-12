import type { Metadata } from "next";
import Link from "next/link";
import { RefreshWhilePending } from "@/components/payments/refresh-while-pending";
import { Alert } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { requireUser } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";

export const metadata: Metadata = { title: "Payment", robots: { index: false } };

/**
 * Where Paystack sends the buyer back. This page only reads: it shows what the
 * database says and checks again every few seconds. Only the verified
 * webhook marks anything as paid.
 */
export default async function PaymentCallbackPage({ searchParams }: PageProps<"/pay/callback">) {
  const query = await searchParams;
  const reference =
    typeof query.reference === "string"
      ? query.reference
      : typeof query.trxref === "string"
        ? query.trxref
        : "";
  const user = await requireUser(`/pay/callback?reference=${encodeURIComponent(reference)}`);

  const { data } = /^[A-Za-z0-9._=-]{1,100}$/.test(reference)
    ? await createServiceClient()
        .from("payments")
        .select("id, status, order:orders!inner(id, status, buyer_id, review_flags)")
        .eq("provider_reference", reference)
        .eq("order.buyer_id", user.id)
        .maybeSingle()
    : { data: null };

  if (!data) {
    return (
      <div className="mx-auto grid max-w-md gap-4 px-4 py-10">
        <h1 className="text-2xl font-bold">Payment not found</h1>
        <p className="text-muted-foreground text-sm">We could not find that payment on your account.</p>
        <Link href="/account/orders" className={buttonVariants({ variant: "outline" })}>
          Your orders
        </Link>
      </div>
    );
  }

  const orderPaid = data.order.status !== "awaiting_payment" && data.order.status !== "cancelled";
  const confirmed = data.status === "success" || orderPaid;
  const failed = data.status === "failed" || data.status === "abandoned";
  const waiting = !confirmed && !failed && data.status !== "mismatch";

  return (
    <div className="mx-auto grid max-w-md gap-4 px-4 py-10">
      <RefreshWhilePending active={waiting} />
      <h1 className="text-2xl font-bold">
        {confirmed
          ? "Payment received"
          : failed
            ? "Payment not completed"
            : data.status === "mismatch"
              ? "We are checking your payment"
              : "Confirming your payment"}
      </h1>
      {confirmed ? (
        <Alert variant="success">
          Thank you. Your payment is confirmed and held safely until your recipient confirms delivery.
          {data.order.review_flags.length > 0
            ? " Our team is also taking a quick look at your order and will contact you if needed."
            : ""}
        </Alert>
      ) : failed ? (
        <Alert variant="destructive">
          The payment did not go through. You have not been charged. You can try again from your order.
        </Alert>
      ) : data.status === "mismatch" ? (
        <Alert>
          Something about this payment needs a check by our team. If you were charged, we will sort it out and
          contact you.
        </Alert>
      ) : (
        <Alert aria-live="polite">
          We are waiting for Paystack to confirm. This usually takes a few seconds. You do not need to pay
          again.
        </Alert>
      )}
      <Link href={`/account/orders/${data.order.id}`} className={buttonVariants()}>
        Go to your order
      </Link>
    </div>
  );
}
