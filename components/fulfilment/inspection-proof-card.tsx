import { InspectionDecision } from "@/components/fulfilment/inspection-decision";
import { Alert } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { InspectionProof } from "@/lib/fulfilment/queries";
import { formatDateTime } from "@/lib/orders/format";
import type { OrderStatus } from "@/lib/orders/state-machine";

/** The pre-shipment proof as the buyer sees it, with Approve and Dispute while an answer is due. */
export function InspectionProofCard({
  orderId,
  status,
  proof,
  viewer = "buyer",
}: {
  orderId: string;
  status: OrderStatus;
  proof: InspectionProof;
  viewer?: "buyer" | "staff";
}) {
  const waiting = status === "inspection_pending" && proof.buyer_decision === null;
  const buyerCanAnswer = waiting && viewer === "buyer";
  return (
    <Card>
      <CardHeader>
        <CardTitle>Inspection proof</CardTitle>
        <CardDescription>
          Uploaded {formatDateTime(proof.created_at)}. These links work for one hour.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {buyerCanAnswer ? (
          <Alert>
            Check the photos and the serial number, then approve or raise a dispute. If we hear nothing within
            48 hours, we treat it as approved and ship the order.
          </Alert>
        ) : null}
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {proof.media.map((item) => (
            <li key={item.id} className="overflow-hidden rounded-lg border">
              {item.type === "video" ? (
                <video
                  src={item.url}
                  controls
                  preload="none"
                  className="aspect-square w-full bg-black object-contain"
                />
              ) : (
                // Signed links change every hour, so next/image caching does not help here.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={item.url}
                  alt="Inspection photo"
                  loading="lazy"
                  className="aspect-square w-full object-cover"
                />
              )}
            </li>
          ))}
        </ul>
        {proof.serial_or_imei ? (
          <p className="text-sm">
            Serial number or IMEI: <span className="font-medium break-all">{proof.serial_or_imei}</span>
          </p>
        ) : null}
        {proof.notes ? <p className="text-sm break-words whitespace-pre-line">{proof.notes}</p> : null}
        {proof.buyer_decision === "approved" ? (
          <p className="text-sm">
            {proof.auto_approved
              ? "Approved automatically after 48 hours."
              : viewer === "buyer"
                ? "You approved this proof."
                : "The buyer approved this proof."}
          </p>
        ) : null}
        {proof.buyer_decision === "disputed" ? (
          <p className="text-sm">
            {viewer === "buyer" ? "You disputed this proof." : "The buyer disputed this proof."}
          </p>
        ) : null}
        {buyerCanAnswer ? <InspectionDecision orderId={orderId} /> : null}
      </CardContent>
    </Card>
  );
}
