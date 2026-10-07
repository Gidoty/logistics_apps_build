import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import type { CurrencyOption } from "@/lib/reference/queries";
import { setViewerCurrency } from "@/lib/pricing/viewer-currency";

/** Picks the currency prices are shown in. A plain form: it works without JavaScript and is remembered in a cookie. */
export function CurrencySwitcher({ current, options }: { current: string; options: CurrencyOption[] }) {
  return (
    <form action={setViewerCurrency} className="flex flex-wrap items-end gap-2">
      <div className="grid gap-1">
        <Label htmlFor="viewer-currency" className="text-xs">
          Show prices in
        </Label>
        <NativeSelect
          id="viewer-currency"
          name="currency"
          defaultValue={current}
          className="h-9 w-auto min-w-24"
        >
          {options.map((option) => (
            <option key={option.code} value={option.code}>
              {option.code}
            </option>
          ))}
        </NativeSelect>
      </div>
      <Button type="submit" variant="outline" size="sm">
        Change
      </Button>
    </form>
  );
}
