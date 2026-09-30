import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { CONDITION_LABELS, PRODUCT_CONDITIONS } from "@/lib/catalog/schemas";
import type { ShopReferences } from "@/lib/catalog/shop-queries";
import { minorToDecimalString } from "@/lib/money";
import type { ShopFilters } from "@/lib/catalog/shop-params";

type Props = {
  filters: ShopFilters;
  refs: ShopReferences;
  brands: { brand: string; count: number }[];
};

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}

/**
 * Search and filters as a plain GET form: the chosen values end up in the URL,
 * so a link to a result page can be shared, and it works without JavaScript.
 * The filters sit in a collapsible panel to keep phone screens short.
 */
export function ShopFiltersForm({ filters, refs, brands }: Props) {
  const digits = filters.currency ? (refs.currencyDigits[filters.currency] ?? 2) : 2;
  const groups = refs.categories.filter((category) => category.parent_slug === null);
  const activeCount = [
    filters.category,
    filters.brand,
    filters.condition,
    filters.origin,
    filters.currency,
    filters.minPriceMinor,
    filters.maxPriceMinor,
  ].filter((value) => value !== null).length;
  const countryName = (code: string) => refs.countries.find((country) => country.code === code)?.name ?? code;

  return (
    <form action="/shop" method="get" className="grid gap-3" role="search">
      <div className="flex gap-2">
        <Input
          name="q"
          type="search"
          defaultValue={filters.q ?? ""}
          placeholder="Search phones, laptops, brands"
          aria-label="Search products"
          maxLength={80}
          enterKeyHint="search"
        />
        <Button type="submit">Search</Button>
      </div>

      <details
        className="rounded-lg border"
        open={activeCount > 0 || filters.sort !== "newest" || filters.sortNeedsCurrency}
      >
        <summary className="cursor-pointer px-3 py-2 text-sm font-medium select-none">
          Filters and sorting{activeCount > 0 ? ` (${activeCount})` : ""}
        </summary>
        <div className="grid gap-3 border-t p-3 sm:grid-cols-2">
          <Field id="category" label="Category">
            <NativeSelect id="category" name="category" defaultValue={filters.category ?? ""}>
              <option value="">All categories</option>
              {groups.map((group) => {
                const children = refs.categories.filter((category) => category.parent_slug === group.slug);
                return children.length > 0 ? (
                  <optgroup key={group.slug} label={group.name}>
                    <option value={group.slug}>All {group.name.toLowerCase()}</option>
                    {children.map((child) => (
                      <option key={child.slug} value={child.slug}>
                        {child.name}
                      </option>
                    ))}
                  </optgroup>
                ) : (
                  <option key={group.slug} value={group.slug}>
                    {group.name}
                  </option>
                );
              })}
            </NativeSelect>
          </Field>

          <Field id="brand" label="Brand">
            <NativeSelect id="brand" name="brand" defaultValue={filters.brand ?? ""}>
              <option value="">All brands</option>
              {brands.map((item) => (
                <option key={item.brand} value={item.brand}>
                  {item.brand} ({item.count})
                </option>
              ))}
            </NativeSelect>
          </Field>

          <Field id="condition" label="Condition">
            <NativeSelect id="condition" name="condition" defaultValue={filters.condition ?? ""}>
              <option value="">Any condition</option>
              {PRODUCT_CONDITIONS.map((condition) => (
                <option key={condition} value={condition}>
                  {CONDITION_LABELS[condition]}
                </option>
              ))}
            </NativeSelect>
          </Field>

          <Field id="origin" label="Ships from">
            <NativeSelect id="origin" name="origin" defaultValue={filters.origin ?? ""}>
              <option value="">Anywhere</option>
              {refs.origins.map((code) => (
                <option key={code} value={code}>
                  {countryName(code)}
                </option>
              ))}
            </NativeSelect>
          </Field>

          <Field id="currency" label="Currency">
            <NativeSelect id="currency" name="currency" defaultValue={filters.currency ?? ""}>
              <option value="">Any currency</option>
              {refs.currencies.map((currency) => (
                <option key={currency.code} value={currency.code}>
                  {currency.code} ({currency.symbol})
                </option>
              ))}
            </NativeSelect>
          </Field>

          <Field id="sort" label="Sort by">
            <NativeSelect id="sort" name="sort" defaultValue={filters.sort}>
              <option value="newest">Newest</option>
              <option value="price_asc">Price: low to high</option>
              <option value="price_desc">Price: high to low</option>
            </NativeSelect>
          </Field>

          <div className="grid grid-cols-2 gap-3 sm:col-span-2">
            <Field id="min" label="Lowest price">
              <Input
                id="min"
                name="min"
                inputMode="decimal"
                placeholder="0"
                defaultValue={
                  filters.minPriceMinor === null ? "" : minorToDecimalString(filters.minPriceMinor, digits)
                }
              />
            </Field>
            <Field id="max" label="Highest price">
              <Input
                id="max"
                name="max"
                inputMode="decimal"
                placeholder="Any"
                defaultValue={
                  filters.maxPriceMinor === null ? "" : minorToDecimalString(filters.maxPriceMinor, digits)
                }
              />
            </Field>
          </div>

          <p
            className="text-muted-foreground text-xs sm:col-span-2"
            role={filters.sortNeedsCurrency ? "status" : undefined}
          >
            {filters.sortNeedsCurrency
              ? "Choose a currency to sort by price. "
              : "Prices are compared within one currency, so choose a currency to filter or sort by price. "}
            Exchange-rate sorting comes later.
          </p>

          <div className="flex gap-2 sm:col-span-2">
            <Button type="submit">Apply</Button>
            <Link href="/shop" className="text-primary inline-flex h-10 items-center px-3 text-sm underline">
              Clear all
            </Link>
          </div>
        </div>
      </details>
    </form>
  );
}
