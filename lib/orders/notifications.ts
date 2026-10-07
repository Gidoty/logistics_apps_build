import "server-only";
import type { Json } from "@/lib/supabase/database.types";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * Adds an email to the outbox (table notifications, status "pending").
 * Sending arrives in Batch 7. Most notifications are queued by the database
 * functions themselves; this is for the few that start in app code.
 * Never throws: a missing notification must not undo the change that caused it.
 */
export async function queueAdminNotification(template: string, payload: Json): Promise<void> {
  try {
    const { error } = await createServiceClient()
      .from("notifications")
      .insert({ audience: "admins", channel: "email", template, payload, status: "pending" });
    if (error) console.error("Could not queue notification", template, error.message);
  } catch (error) {
    console.error("Could not queue notification", template, error);
  }
}
