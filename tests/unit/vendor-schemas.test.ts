import { describe, expect, it } from "vitest";
import {
  payoutDetailsSchema,
  payoutRequestTokenSchema,
  rejectionNoteSchema,
  suspensionNoteSchema,
  vendorApplicationSchema,
  vendorIdSchema,
} from "@/lib/vendors/schemas";

describe("vendorApplicationSchema", () => {
  it("trims and normalizes input", () => {
    expect(
      vendorApplicationSchema.parse({ businessName: "  Ada Gadgets ", countryCode: "ng", city: " Lagos " }),
    ).toEqual({ businessName: "Ada Gadgets", countryCode: "NG", city: "Lagos" });
  });

  it.each([
    ["short business name", { businessName: "A" }, "businessName"],
    ["missing city", { city: "  " }, "city"],
    ["bad country", { countryCode: "Nigeria" }, "countryCode"],
  ])("rejects %s", (_label, override, field) => {
    const result = vendorApplicationSchema.safeParse({
      businessName: "Ada Gadgets",
      countryCode: "NG",
      city: "Lagos",
      ...override,
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path[0])).toContain(field);
  });

  it("ignores a status field sent by the client", () => {
    const parsed = vendorApplicationSchema.parse({
      businessName: "Ada Gadgets",
      countryCode: "NG",
      city: "Lagos",
      status: "approved",
    });
    expect(parsed).not.toHaveProperty("status");
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
