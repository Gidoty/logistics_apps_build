import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { OrderTimeline } from "@/components/orders/order-timeline";
import { DeliveryCodeForm } from "@/components/tracking/code-form";
import { Alert } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime } from "@/lib/orders/format";
import { buildFulfilmentTimeline } from "@/lib/orders/timeline";
import { getTracking } from "@/lib/tracking/queries";
import { allowTrackingView } from "@/lib/tracking/throttle";

// The link is the only credential, so keep it out of search engines and caches.
export const metadata: Metadata = {
  title: "Track your delivery",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

export default async function TrackingPage({ params }: PageProps<"/t/[token]">) {
  const { token } = await params;
  if (!(await allowTrackingView(await headers()))) {
    return (
      <div className="mx-auto grid max-w-lg gap-4 px-4 py-10">
        <Alert variant="destructive">
          Too many requests from this device. Please try again in a few minutes.
        </Alert>
      </div>
    );
  }
  const tracking = await getTracking(token);
  if (!tracking) notFound();

  const timeline = buildFulfilmentTimeline(tracking.status);
  // Only steps the order really passed get a date. History holds status and time, nothing else.
  const stamp = new Map(tracking.history.flatMap((h) => (h.status ? [[h.status, h.at] as const] : [])));

  return (
    <div className="mx-auto grid max-w-lg gap-5 px-4 py-8">
      <div className="grid gap-1">
        <h1 className="text-2xl font-bold">Delivery tracking</h1>
        <p className="text-muted-foreground text-sm break-words">
          {tracking.item ?? "Your order"}
          {tracking.recipient_first_name ? ` for ${tracking.recipient_first_name}` : ""}
          {tracking.recipient_city ? `, ${tracking.recipient_city}` : ""}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Progress</CardTitle>
          <CardDescription>Last update {formatDateTime(tracking.updated_at)}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <OrderTimeline steps={timeline} />
          {tracking.status === "delivered" && stamp.get("delivered") ? (
            <p className="text-sm">Delivered {formatDateTime(stamp.get("delivered")!)}.</p>
          ) : null}
        </CardContent>
      </Card>

      {tracking.status === "refunded" || tracking.status === "disputed" ? (
        <Alert>
          This order is being looked at by our team. Please contact the sender if you have questions.
        </Alert>
      ) : null}

      {tracking.can_enter_code ? (
        <Card>
          <CardHeader>
            <CardTitle>Confirm delivery</CardTitle>
            <CardDescription>
              The sender gave you a 6-digit code. Give it to the rider after you check your item.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <DeliveryCodeForm token={token} />
          </CardContent>
        </Card>
      ) : null}

      {tracking.code_locked ? (
        <Alert variant="destructive">
          The delivery code is locked after too many wrong tries. Contact the sender or our support to unlock
          it.
        </Alert>
      ) : null}
    </div>
  );
}
