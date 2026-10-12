"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Reloads the page's data every few seconds while a payment is being confirmed, for at most about two minutes. */
export function RefreshWhilePending({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    let runs = 0;
    const id = window.setInterval(() => {
      runs += 1;
      router.refresh();
      if (runs >= 40) window.clearInterval(id);
    }, 3000);
    return () => window.clearInterval(id);
  }, [active, router]);
  return null;
}
