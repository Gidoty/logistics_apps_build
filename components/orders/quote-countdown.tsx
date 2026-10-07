"use client";

import { useRouter } from "next/navigation";
import { useEffect, useSyncExternalStore } from "react";
import { formatCountdown } from "@/lib/orders/format";

function subscribe(onTick: () => void) {
  const id = window.setInterval(onTick, 1000);
  return () => window.clearInterval(id);
}
const snapshot = () => Math.floor(Date.now() / 1000) * 1000;
// Nothing is printed on the server: the time left depends on the browser's clock.
const serverSnapshot = () => null;

/** Live time left on a quote. When it reaches zero the page reloads its data, so the buyer sees the expired state. */
export function QuoteCountdown({ expiresAt }: { expiresAt: string }) {
  const router = useRouter();
  const now = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const text = now === null ? null : formatCountdown(expiresAt, new Date(now));
  const expired = now !== null && text === null;

  useEffect(() => {
    if (expired) router.refresh();
  }, [expired, router]);

  if (now === null) return <span className="text-muted-foreground">Checking time left...</span>;
  if (expired) return <span className="text-destructive font-medium">Expired</span>;
  return <span className="font-medium tabular-nums">{text} left</span>;
}
