import "server-only";
import { createHmac } from "node:crypto";
import { getServerEnv } from "@/lib/env";
import { clientIp } from "@/lib/pricing/estimate-throttle";
import { createServiceClient } from "@/lib/supabase/service";

function bucket(kind: string, ip: string): string {
  const key = getServerEnv().SUPABASE_SERVICE_ROLE_KEY;
  return `${kind}:${createHmac("sha256", key).update(ip).digest("hex").slice(0, 32)}`;
}

async function hit(name: string, limit: number, windowSeconds: number, failOpen: boolean): Promise<boolean> {
  try {
    const { data, error } = await createServiceClient().rpc("throttle_hit", {
      _bucket: name,
      _limit: limit,
      _window_seconds: windowSeconds,
    });
    if (error) throw new Error(error.message);
    return data === true;
  } catch (error) {
    console.error("Tracking throttle failed", error instanceof Error ? error.message : error);
    return failOpen;
  }
}

/** Page views: 120 an hour per visitor. If the counter breaks, the page still opens. */
export function allowTrackingView(headers: Pick<Headers, "get">): Promise<boolean> {
  return hit(bucket("track-view", clientIp(headers)), 120, 3600, true);
}

/**
 * Code entries: 20 per 10 minutes per visitor. If the counter breaks, entry is
 * refused: this is the guard against guessing codes. The 5-try lock on each
 * order is a second, separate limit.
 */
export function allowCodeEntry(headers: Pick<Headers, "get">): Promise<boolean> {
  return hit(bucket("track-code", clientIp(headers)), 20, 600, false);
}
