import { z } from "zod";
import type { OrderStatus } from "@/lib/orders/state-machine";

/**
 * What the public tracking page may show. This is the shape get_tracking()
 * returns, checked again here: if the database ever sent an extra field, the
 * parse strips it before it can reach the page.
 */
const trackingSchema = z.object({
  status: z.string(),
  item: z.string().nullable(),
  recipient_first_name: z.string().nullable(),
  recipient_city: z.string().nullable(),
  updated_at: z.string(),
  can_enter_code: z.boolean(),
  code_locked: z.boolean(),
  history: z.array(z.object({ status: z.string().nullable(), at: z.string() })),
});

export type TrackingData = Omit<z.infer<typeof trackingSchema>, "status"> & { status: OrderStatus };

export const TRACKING_TOKEN_PATTERN = /^[0-9a-f]{32}$/;

export function parseTracking(value: unknown): TrackingData | null {
  const parsed = trackingSchema.safeParse(value);
  return parsed.success ? { ...parsed.data, status: parsed.data.status as OrderStatus } : null;
}
