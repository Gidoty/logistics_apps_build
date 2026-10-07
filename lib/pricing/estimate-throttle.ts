import "server-only";
import { createHmac } from "node:crypto";
import { getServerEnv } from "@/lib/env";
import { createServiceClient } from "@/lib/supabase/service";

export const ESTIMATE_LIMIT = 30;
export const ESTIMATE_WINDOW_SECONDS = 3600;

/**
 * The visitor's IP address as seen by the host. On Vercel the platform sets
 * x-forwarded-for itself, so the first address is the real client. Other hosts
 * must do the same, or this limit can be dodged by sending a fake header.
 */
export function clientIp(headers: Pick<Headers, "get">): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || headers.get("x-real-ip")?.trim() || "unknown";
}

/** A stable label for the bucket that does not reveal the address: HMAC with a server-only secret. */
export function ipBucket(ip: string): string {
  const key = getServerEnv().SUPABASE_SERVICE_ROLE_KEY;
  return `estimate:${createHmac("sha256", key).update(ip).digest("hex").slice(0, 32)}`;
}

/**
 * Counts one estimate for this visitor. Returns false once they have used 30 in
 * the hour. The count lives in the database, so every server instance shares
 * it. If the check itself fails the estimate is allowed: it is a plain
 * calculation, and a broken counter should not take the page down.
 */
export async function allowEstimate(headers: Pick<Headers, "get">): Promise<boolean> {
  try {
    const { data, error } = await createServiceClient().rpc("throttle_hit", {
      _bucket: ipBucket(clientIp(headers)),
      _limit: ESTIMATE_LIMIT,
      _window_seconds: ESTIMATE_WINDOW_SECONDS,
    });
    if (error) {
      console.error("Estimate throttle failed", error.message);
      return true;
    }
    return data === true;
  } catch (error) {
    console.error("Estimate throttle failed", error);
    return true;
  }
}
