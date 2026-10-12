import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import { parseTracking, TRACKING_TOKEN_PATTERN, type TrackingData } from "./data";

/**
 * Reads the tracking record with the service role through get_tracking(),
 * which selects only the safe fields. The function is not granted to anon, so
 * the page's own throttle cannot be skipped by calling the database directly.
 */
export async function getTracking(token: string): Promise<TrackingData | null> {
  if (!TRACKING_TOKEN_PATTERN.test(token)) return null;
  const { data, error } = await createServiceClient().rpc("get_tracking", { _token: token });
  if (error) throw new Error(`Could not load tracking: ${error.message}`);
  return data === null ? null : parseTracking(data);
}
