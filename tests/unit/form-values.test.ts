import { describe, expect, it } from "vitest";
import { emptyProductValues, productToFormValues, specsToRows } from "@/lib/catalog/form-values";
import { createProductSchema } from "@/lib/catalog/schemas";

const CORRIDOR = "6f1c2c8e-8a4b-4f7e-9d3a-2b1e5c7d9f00";

describe("productToFormValues", () => {
  const stored = {
    title: "EcoFlow River 2 Pro",
    description: "768Wh portable power station with solar input.",
    brand: null,
    category: "solar_power",
    condition: "open_box" as const,
    condition_notes: "Box opened, unit never used.",
    price_minor: 129_950,
    currency: "CNY",
    stock: 4,
    weight_grams: null,
    corridor_id: CORRIDOR,
    warranty_months: 12,
    requires_special_handling: true,
    specs: { Capacity: "768 Wh", Output: "800 W", Ignored: 5 },
  };

  it("shows the price in normal units and turns empty values into empty text", () => {
    expect(productToFormValues(stored, { CNY: 2 })).toEqual({
      title: "EcoFlow River 2 Pro",
      description: "768Wh portable power station with solar input.",
      brand: "",
      category: "solar_power",
      condition: "open_box",
      conditionNotes: "Box opened, unit never used.",
      price: "1299.50",
      currency: "CNY",
      stock: "4",
      weightGrams: "",
      corridorId: CORRIDOR,
      warrantyMonths: "12",
      requiresSpecialHandling: true,
      specs: [
        { key: "Capacity", value: "768 Wh" },
        { key: "Output", value: "800 W" },
      ],
    });
  });

  it("round-trips through the product schema back to the same minor-unit price", () => {
    const schema = createProductSchema({
      categories: ["solar_power"],
      currencies: { CNY: 2 },
      corridorIds: [CORRIDOR],
    });
    const values = { ...productToFormValues(stored, { CNY: 2 }), weightGrams: "9000" };
    expect(schema.parse(values).priceMinor).toBe(129_950);
  });
});

describe("form defaults", () => {
  it("starts empty with the vendor's currency and route", () => {
    const values = emptyProductValues("NGN", CORRIDOR);
    expect(values).toMatchObject({ currency: "NGN", corridorId: CORRIDOR, condition: "new", stock: "1" });
    expect(values.specs).toEqual([{ key: "", value: "" }]);
  });

  it("reads specs only from plain objects of text", () => {
    expect(specsToRows(null)).toEqual([]);
    expect(specsToRows([{ a: "b" }])).toEqual([]);
    expect(specsToRows({ a: "b", c: 1 })).toEqual([{ key: "a", value: "b" }]);
  });
});
