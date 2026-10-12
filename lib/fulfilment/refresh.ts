import { revalidatePath } from "next/cache";
import { refreshOrderPages } from "@/lib/orders/refresh";

/** Re-reads the shipment pages and the pages of the orders a shipment event touched. */
export function refreshShipmentPages(orderIds: string[]) {
  revalidatePath("/admin/shipments");
  for (const id of orderIds) refreshOrderPages(id);
}
