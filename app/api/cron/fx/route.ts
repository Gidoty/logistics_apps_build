import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { isAuthorizedCron } from "@/lib/fx/cron-auth";
import { OpenErApiProvider } from "@/lib/fx/provider";
import { refreshFxRates } from "@/lib/fx/refresh";
import { createFxStore } from "@/lib/fx/store";
import { queueAdminNotification } from "@/lib/orders/notifications";
import { PRICING_CACHE_TAG } from "@/lib/pricing/cache-tags";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Fetches exchange rates. Called by the Vercel cron (vercel.json) every 6
 * hours. Needs the CRON_SECRET; without it the answer is 401 and nothing runs.
 */
export async function GET(request: Request) {
  if (!isAuthorizedCron(request.headers, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await refreshFxRates(new OpenErApiProvider(), createFxStore());
    if (result.rejected.length > 0) {
      await queueAdminNotification("fx_rate_held_back", { rejected: result.rejected });
    }
    revalidateTag(PRICING_CACHE_TAG, { expire: 0 });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("FX refresh failed", message);
    await queueAdminNotification("fx_fetch_failed", { message: message.slice(0, 300) });
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
