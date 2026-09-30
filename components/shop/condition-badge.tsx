import { Badge } from "@/components/ui/badge";
import { CONDITION_LABELS, type ProductCondition } from "@/lib/catalog/schemas";

/** Shows the condition. New items get no badge in the grid, to keep it quiet. */
export function ConditionBadge({
  condition,
  showNew = false,
}: {
  condition: ProductCondition;
  showNew?: boolean;
}) {
  if (condition === "new" && !showNew) return null;
  return <Badge variant={condition === "new" ? "default" : "secondary"}>{CONDITION_LABELS[condition]}</Badge>;
}
