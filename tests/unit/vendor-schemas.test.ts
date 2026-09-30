import { describe, expect, it } from "vitest";
import {
  payoutDetailsSchema,
  payoutRequestTokenSchema,
  rejectionNoteSchema,
  suspensionNoteSchema,
  createVendorApplicationSchema,
  vendorReviewSchema,
  vendorIdSchema,
} from "@/lib/vendors/schemas";

const USER_ID = "6f1c2c8e-8a4b-4f7e-9d3a-2b1e5c7d9f00";
const OTHER_USER_ID = "0b9d1a52-3c4e-4a6f-8b7d-1e2f3a4b5c6d";

const applicationSchema = createVendorApplicationSchema({
  countries: ["NG", "CN", "GB"],
  categories: ["phones", "laptops", "solar_power"],
  userId: USER_ID,
});

const validApplication = {
  businessName: "  Ada Gadgets ",
  countryCode: "ng",
  city: " Lagos ",
  phone: "+234 803 123 4567",
  businessRegNumber: "",
  categories: ["phones", "laptops"],
  documentPath: `${USER_ID}/id_1.pdf`,
};

describe("createVendorApplicationSchema", () => {
  it("trims and normalizes a valid application", () => {
    expect(applicationSchema.parse(validApplication)).toEqual({
      businessName: "Ada Gadgets",
      countryCode: "NG",
      city: "Lagos",
      phone: "+2348031234567",
      businessRegNumber: null,
      categories: ["phones", "laptops"],
      documentPath: `${USER_ID}/id_1.pdf`,
    });
  });

  it("keeps an optional registration number", () => {
    expect(
      applicationSchema.parse({ ...validApplication, businessRegNumber: " RC 1234567 " }).businessRegNumber,
    ).toBe("RC 1234567");
  });

  it.each([
    ["short business name", { businessName: "A" }, "businessName"],
    ["missing city", { city: "  " }, "city"],
    ["unknown country", { countryCode: "ZZ" }, "countryCode"],
    ["country name instead of code", { countryCode: "Nigeria" }, "countryCode"],
    ["local phone format", { phone: "08031234567" }, "phone"],
    ["missing phone", { phone: "" }, "phone"],
    ["no categories", { categories: [] }, "categories"],
    ["a prohibited category", { categories: ["weapons"] }, "categories"],
    ["a group instead of a category", { categories: ["electronics"] }, "categories"],
    ["a repeated category", { categories: ["phones", "phones"] }, "categories"],
    ["13 categories", { categories: Array.from({ length: 13 }, (_, i) => `c${i}`) }, "categories"],
    ["no document", { documentPath: "" }, "documentPath"],
    ["another user's document", { documentPath: `${OTHER_USER_ID}/id_1.pdf` }, "documentPath"],
    ["a document with a bad extension", { documentPath: `${USER_ID}/id_1.exe` }, "documentPath"],
    ["a document outside the folder", { documentPath: `${USER_ID}/../x.pdf` }, "documentPath"],
    ["an over-long registration number", { businessRegNumber: "9".repeat(51) }, "businessRegNumber"],
  ])("rejects %s", (_label, override, field) => {
    const result = applicationSchema.safeParse({ ...validApplication, ...override });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => String(issue.path[0]))).toContain(field);
  });

  it("ignores a status field sent by the client", () => {
    expect(applicationSchema.parse({ ...validApplication, status: "approved" })).not.toHaveProperty("status");
  });
});

describe("vendorReviewSchema", () => {
  const vendorId = "6f1c2c8e-8a4b-4f7e-9d3a-2b1e5c7d9f00";

  it("approves without a reason", () => {
    expect(vendorReviewSchema.parse({ vendorId, intent: "approve" })).toMatchObject({
      intent: "approve",
      reason: "",
    });
  });

  it.each(["reject", "suspend"])("needs a reason to %s", (intent) => {
    const result = vendorReviewSchema.safeParse({ vendorId, intent, reason: "no" });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["reason"]);
    expect(vendorReviewSchema.safeParse({ vendorId, intent, reason: " ID photo is blurry. " }).success).toBe(
      true,
    );
  });

  it("rejects unknown actions and bad ids", () => {
    expect(
      vendorReviewSchema.safeParse({ vendorId, intent: "delete", reason: "long enough reason" }).success,
    ).toBe(false);
    expect(vendorReviewSchema.safeParse({ vendorId: "1", intent: "approve" }).success).toBe(false);
  });
});

describe("admin vendor inputs", () => {
  it("requires a uuid vendor id", () => {
    expect(vendorIdSchema.safeParse("6f1c2c8e-8a4b-4f7e-9d3a-2b1e5c7d9f00").success).toBe(true);
    expect(vendorIdSchema.safeParse("1 or 1=1").success).toBe(false);
  });

  it("turns an empty suspension note into null", () => {
    expect(suspensionNoteSchema.parse("   ")).toBeNull();
    expect(suspensionNoteSchema.parse(" Fake photos ")).toBe("Fake photos");
  });
});

describe("payoutDetailsSchema", () => {
  it("accepts a small set of trimmed text fields", () => {
    expect(
      payoutDetailsSchema.parse({
        bank_name: " GTBank ",
        account_name: "Ada Gadgets",
        account_number: "0123456789",
      }),
    ).toEqual({ bank_name: "GTBank", account_name: "Ada Gadgets", account_number: "0123456789" });
  });

  it.each([
    ["empty object", {}],
    ["empty value", { bank_name: "  " }],
    ["non-string value", { account_number: 123456 }],
    ["bad field name", { "Bank Name": "GTBank" }],
    ["oversized value", { note: "x".repeat(201) }],
    ["too many fields", Object.fromEntries(Array.from({ length: 13 }, (_, i) => [`field_${i}`, "x"]))],
    ["array", ["GTBank"]],
    ["null", null],
  ])("rejects %s", (_label, input) => {
    expect(payoutDetailsSchema.safeParse(input).success).toBe(false);
  });
});

describe("payout review inputs", () => {
  it("requires a uuid request token", () => {
    expect(payoutRequestTokenSchema.safeParse("6f1c2c8e-8a4b-4f7e-9d3a-2b1e5c7d9f00").success).toBe(true);
    expect(payoutRequestTokenSchema.safeParse("2026-09-30T10:15:30.123456+00:00").success).toBe(false);
  });

  it("turns an empty rejection note into null and caps length", () => {
    expect(rejectionNoteSchema.parse("  ")).toBeNull();
    expect(rejectionNoteSchema.safeParse("x".repeat(501)).success).toBe(false);
  });
});
