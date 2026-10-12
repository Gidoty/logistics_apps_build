import { revalidatePath } from "next/cache";

/** Re-reads every page that shows this order. Not an action itself: server action files may only export actions. */
export function refreshOrderPages(orderId: string) {
  revalidatePath("/admin/orders");
  revalidatePath(`/admin/orders/${orderId}`);
  revalidatePath("/account/orders");
  revalidatePath(`/account/orders/${orderId}`);
  revalidatePath("/vendor/orders");
}
