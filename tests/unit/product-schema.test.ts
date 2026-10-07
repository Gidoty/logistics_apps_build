import { describe, expect, it } from "vitest";
import { createProductSchema, fieldErrorsFromIssues, type ProductFormContext } from "@/lib/catalog/schemas";

const CORRIDOR = "6f1c2c8e-8a4b-4f7e-9d3a-2b1e5c7d9f00";

// The allowed categories are what the database says listings may use.
// Prohibited ones (weapons, drugs, counterfeit, hazardous) and groups are not in this list.
const context: ProductFormContext = {
  categories: ["phones", "laptops", "solar_power", "accessories"],
  currencies: { NGN: 2, CNY: 2, USD: 2 },
  corridorIds: [CORRIDOR],
};
const schema = createProductSchema(context);

const valid = {
  title: "Samsung Galaxy A15 128GB",
  description: "Brand new, sealed box. Dual SIM, 6.5 inch display, 5000 mAh battery.",
  brand: "Samsung",
  category: "phones",
  condition: "new",
  conditionNotes: "",
  price: "1,299.50",
  currency: "CNY",
  stock: "5",
  weightGrams: "250",
  corridorId: CORRIDOR,
  warrantyMonths: "12",
  requiresSpecialHandling: false,
  specs: [
    { key: "RAM", value: "6 GB" },
    { key: "Storage", value: "128 GB" },
    { key: "", value: "" },
  ],
};

const errorsFor = (override: object) => {
  const result = schema.safeParse({ ...valid, ...override });
  if (result.success) throw new Error("expected the input to fail");
  return fieldErrorsFromIssues(result.error.issues);
};

describe("product schema: valid input", () => {
  it("passes and converts the price to minor units", () => {
    const result = schema.parse(valid);
    expect(result).toEqual({
      title: "Samsung Galaxy A15 128GB",
      description: "Brand new, sealed box. Dual SIM, 6.5 inch display, 5000 mAh battery.",
      brand: "Samsung",
      category: "phones",
      condition: "new",
      conditionNotes: null,
      priceMinor: 129_950,
      currency: "CNY",
      stock: 5,
      weightGrams: 250,
      lengthCm: null,
      widthCm: null,
      heightCm: null,
      corridorId: CORRIDOR,
      warrantyMonths: 12,
      requiresSpecialHandling: false,
      specs: { RAM: "6 GB", Storage: "128 GB" },
    });
  });

  it("accepts a used item with condition notes, and optional fields left out", () => {
    const result = schema.parse({
      ...valid,
      condition: "used",
      conditionNotes: "Light scratches on the back, battery health 88%.",
      brand: undefined,
      warrantyMonths: undefined,
      specs: undefined,
      price: "250000",
      currency: "NGN",
    });
    expect(result.priceMinor).toBe(25_000_000);
    expect(result.brand).toBeNull();
    expect(result.warrantyMonths).toBe(0);
    expect(result.specs).toEqual({});
  });

  it("accepts numbers as well as text for whole-number fields", () => {
    expect(schema.parse({ ...valid, stock: 3, weightGrams: 900, warrantyMonths: 6 })).toMatchObject({
      stock: 3,
      weightGrams: 900,
      warrantyMonths: 6,
    });
  });
});

describe("product schema: condition notes", () => {
  it.each(["used", "open_box", "refurbished"])("are required when the condition is %s", (condition) => {
    expect(errorsFor({ condition, conditionNotes: "" }).conditionNotes).toBeDefined();
    expect(errorsFor({ condition, conditionNotes: "short" }).conditionNotes).toBeDefined();
  });

  it("are optional when the condition is new", () => {
    expect(schema.safeParse({ ...valid, condition: "new", conditionNotes: "" }).success).toBe(true);
    expect(schema.parse({ ...valid, condition: "new", conditionNotes: "Sealed box" }).conditionNotes).toBe(
      "Sealed box",
    );
  });
});

describe("product schema: categories", () => {
  it.each(["weapons", "drugs", "counterfeit", "hazardous"])(
    "rejects the prohibited category %s",
    (category) => {
      expect(errorsFor({ category }).category).toEqual(["Choose a category from the list."]);
    },
  );

  it("rejects a group name and unknown categories", () => {
    expect(errorsFor({ category: "electronics" }).category).toBeDefined();
    expect(errorsFor({ category: "toys" }).category).toBeDefined();
    expect(errorsFor({ category: "" }).category).toBeDefined();
  });
});

describe("product schema: price", () => {
  it.each([
    ["", "Enter an amount."],
    ["abc", /numbers only/],
    ["19.999", "Use at most 2 decimal places."],
    ["0", "Enter an amount above zero."],
    ["-5", /numbers only/],
    ["10000000000.01", "That amount is too large."],
  ])('rejects "%s"', (price, message) => {
    const errors = errorsFor({ price }).price;
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(message);
  });

  it("follows the currency's decimal places", () => {
    const yen = createProductSchema({ ...context, currencies: { JPY: 0, NGN: 2 } });
    expect(yen.parse({ ...valid, currency: "JPY", price: "15000" }).priceMinor).toBe(15000);
    expect(yen.safeParse({ ...valid, currency: "JPY", price: "150.50" }).success).toBe(false);
  });

  it("rejects a currency that is not active", () => {
    expect(errorsFor({ currency: "EUR" }).currency).toBeDefined();
  });
});

describe("product schema: other fields", () => {
  it.each([
    ["title", { title: "A" }],
    ["title", { title: "x".repeat(201) }],
    ["description", { description: "too short" }],
    ["stock", { stock: "-1" }],
    ["stock", { stock: "2.5" }],
    ["stock", { stock: "" }],
    ["weightGrams", { weightGrams: "0" }],
    ["weightGrams", { weightGrams: "" }],
    ["weightGrams", { weightGrams: "600000" }],
    ["warrantyMonths", { warrantyMonths: "121" }],
    ["corridorId", { corridorId: "00000000-0000-4000-8000-000000000000" }],
    ["condition", { condition: "broken" }],
  ])("rejects a bad %s", (field, override) => {
    expect(errorsFor(override)[field]).toBeDefined();
  });

  it("reports several problems at once where fields are independent", () => {
    const errors = errorsFor({ title: "", category: "weapons", stock: "x" });
    expect(Object.keys(errors).sort()).toEqual(["category", "stock", "title"]);
  });
});

describe("product schema: specs", () => {
  it("ignores blank rows and keeps the typed name casing", () => {
    const result = schema.parse({
      ...valid,
      specs: [
        { key: " Screen size ", value: " 6.5 in " },
        { key: "", value: "" },
      ],
    });
    expect(result.specs).toEqual({ "Screen size": "6.5 in" });
  });

  it("rejects half-filled rows and duplicate names ignoring case", () => {
    expect(errorsFor({ specs: [{ key: "RAM", value: "" }] }).specs).toBeDefined();
    expect(errorsFor({ specs: [{ key: "", value: "8 GB" }] }).specs).toBeDefined();
    expect(
      errorsFor({
        specs: [
          { key: "RAM", value: "8 GB" },
          { key: "ram", value: "16 GB" },
        ],
      }).specs,
    ).toBeDefined();
  });

  it("limits the number of specs and the length of names and values", () => {
    const many = Array.from({ length: 21 }, (_, i) => ({ key: `Spec ${i}`, value: "x" }));
    expect(errorsFor({ specs: many }).specs).toBeDefined();
    expect(errorsFor({ specs: [{ key: "k".repeat(41), value: "x" }] }).specs).toBeDefined();
    expect(errorsFor({ specs: [{ key: "k", value: "v".repeat(101) }] }).specs).toBeDefined();
  });
});

describe("product schema: box size", () => {
  const schema = createProductSchema(context);

  it("accepts all three sizes, or none", () => {
    expect(schema.parse({ ...valid, lengthCm: "30", widthCm: "20.5", heightCm: "10" })).toMatchObject({
      lengthCm: 30,
      widthCm: 20.5,
      heightCm: 10,
    });
    expect(schema.parse({ ...valid })).toMatchObject({ lengthCm: null, widthCm: null, heightCm: null });
  });

  it.each([
    ["only one size", { lengthCm: "30" }],
    ["two sizes", { lengthCm: "30", widthCm: "20" }],
    ["zero", { lengthCm: "0", widthCm: "20", heightCm: "10" }],
    ["too many decimals", { lengthCm: "30.123", widthCm: "20", heightCm: "10" }],
    ["too large", { lengthCm: "1001", widthCm: "20", heightCm: "10" }],
    ["text", { lengthCm: "big", widthCm: "20", heightCm: "10" }],
  ])("rejects %s", (_name, extra) => {
    expect(schema.safeParse({ ...valid, ...extra }).success).toBe(false);
  });
});
