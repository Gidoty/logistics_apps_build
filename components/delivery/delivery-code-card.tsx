import { Alert } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { BuyerDelivery } from "@/lib/delivery/queries";

/** The buyer's view while the order is out for delivery: the code, and a one-tap message to the recipient. */
export function DeliveryCodeCard({ delivery }: { delivery: BuyerDelivery }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Delivery code</CardTitle>
        <CardDescription>
          Your order is out for delivery. Send the recipient this code. They give it to the rider once they
          have the item. Delivery is confirmed when it is entered.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <p
          className="bg-muted rounded-lg py-4 text-center text-4xl font-bold tracking-[0.35em] tabular-nums"
          aria-label={`Delivery code ${delivery.code.split("").join(" ")}`}
        >
          {delivery.code}
        </p>
        {delivery.locked ? (
          <Alert variant="destructive">
            The code was entered wrongly 5 times and is locked. Contact us and we will unlock it.
          </Alert>
        ) : null}
        <a
          href={delivery.whatsappUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="bg-primary text-primary-foreground inline-flex h-10 items-center justify-center rounded-md px-4 text-sm font-medium"
        >
          Send to recipient on WhatsApp
        </a>
        <p className="text-muted-foreground text-xs break-all">
          Tracking link for the recipient:{" "}
          <a className="text-primary underline" href={delivery.trackingUrl}>
            {delivery.trackingUrl}
          </a>
        </p>
      </CardContent>
    </Card>
  );
}
