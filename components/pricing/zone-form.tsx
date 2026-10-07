"use client";

import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveDeliveryZone } from "@/lib/pricing/admin-actions";
import { fieldError, useAdminAction } from "./use-admin-action";

type Props = {
  zoneId?: string;
  initialName: string;
  initialStates: string[];
  allStates: string[];
  /** state -> name of the zone that holds it, for states in other zones */
  takenBy: Record<string, string>;
};

export function ZoneForm({ zoneId, initialName, initialStates, allStates, takenBy }: Props) {
  const { pending, result, run } = useAdminAction();
  const [name, setName] = useState(initialName);
  const [states, setStates] = useState<string[]>(initialStates);
  const id = zoneId ?? "new-zone";

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        run(() => saveDeliveryZone({ zoneId: zoneId ?? "", name, states }));
      }}
      className="grid gap-3"
      noValidate
    >
      {result ? <Alert variant={result.ok ? "success" : "destructive"}>{result.message}</Alert> : null}
      <div className="grid gap-1 sm:max-w-xs">
        <Label htmlFor={`${id}-name`} className="text-xs">
          Zone name
        </Label>
        <Input id={`${id}-name`} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
        {fieldError(result, "name") ? (
          <p className="text-destructive text-xs">{fieldError(result, "name")}</p>
        ) : null}
      </div>
      <fieldset>
        <legend className="mb-1 text-xs font-medium">States ({states.length} chosen)</legend>
        <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
          {allStates.map((state) => {
            const other = takenBy[state];
            const checked = states.includes(state);
            return (
              <label key={state} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="size-4"
                  checked={checked}
                  disabled={Boolean(other) && !checked}
                  onChange={(e) =>
                    setStates((current) =>
                      e.target.checked ? [...current, state] : current.filter((s) => s !== state),
                    )
                  }
                />
                <span className={other && !checked ? "text-muted-foreground" : ""}>
                  {state}
                  {other && !checked ? ` (${other})` : ""}
                </span>
              </label>
            );
          })}
        </div>
        {fieldError(result, "states") ? (
          <p className="text-destructive mt-1 text-xs">{fieldError(result, "states")}</p>
        ) : null}
      </fieldset>
      <div>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Saving..." : zoneId ? "Save zone" : "Add zone"}
        </Button>
      </div>
    </form>
  );
}
