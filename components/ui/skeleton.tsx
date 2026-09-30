import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/** Grey placeholder shown while a page loads. Plain CSS, no JavaScript. */
export function Skeleton({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden="true"
      className={cn("bg-muted animate-pulse rounded-md", className)}
      {...props}
    />
  );
}
