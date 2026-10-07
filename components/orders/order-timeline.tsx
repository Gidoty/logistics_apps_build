import type { TimelineStep } from "@/lib/orders/timeline";
import { cn } from "@/lib/utils";

const MARKS: Record<TimelineStep["state"], string> = {
  done: "bg-success border-success text-white",
  current: "border-primary text-primary border-2",
  upcoming: "border-muted-foreground/40 text-muted-foreground",
  problem: "bg-destructive border-destructive text-white",
};

export function OrderTimeline({ steps }: { steps: TimelineStep[] }) {
  return (
    <ol className="grid gap-3" aria-label="Order progress">
      {steps.map((step, index) => (
        <li
          key={step.key}
          aria-current={step.state === "current" ? "step" : undefined}
          className="flex items-center gap-3 text-sm"
        >
          <span
            aria-hidden="true"
            className={cn(
              "flex size-6 shrink-0 items-center justify-center rounded-full border text-xs",
              MARKS[step.state],
            )}
          >
            {step.state === "done" ? "✓" : step.state === "problem" ? "!" : index + 1}
          </span>
          <span
            className={cn(
              step.state === "upcoming" && "text-muted-foreground",
              step.state === "current" && "font-medium",
              step.state === "problem" && "text-destructive font-medium",
            )}
          >
            {step.label}
            <span className="sr-only">
              {step.state === "done" ? " (done)" : step.state === "current" ? " (current step)" : ""}
            </span>
          </span>
        </li>
      ))}
    </ol>
  );
}
