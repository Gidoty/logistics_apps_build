import { describe, expect, it } from "vitest";
import { emailOtpTypeSchema, newPasswordSchema, signInSchema, signUpSchema } from "./schemas";

const validSignUp = {
  fullName: "  Ada Obi  ",
  email: "  Ada@Example.COM ",
  password: "secret123",
  countryCode: "gb",
};

describe("signUpSchema", () => {
  it("trims and normalizes valid input", () => {
    expect(signUpSchema.parse(validSignUp)).toEqual({
      fullName: "Ada Obi",
      email: "ada@example.com",
      password: "secret123",
      countryCode: "GB",
    });
  });

  it.each([
    ["short password", { password: "abc12" }, "password"],
    ["password without digits", { password: "abcdefgh" }, "password"],
    ["password without letters", { password: "12345678" }, "password"],
    ["password over bcrypt limit", { password: `a1${"x".repeat(71)}` }, "password"],
    ["bad email", { email: "ada@" }, "email"],
    ["one-letter name", { fullName: "A" }, "fullName"],
    ["country name instead of code", { countryCode: "Nigeria" }, "countryCode"],
  ])("rejects %s", (_label, override, field) => {
    const result = signUpSchema.safeParse({ ...validSignUp, ...override });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path[0])).toContain(field);
  });
});

describe("signInSchema", () => {
  it("does not apply strength rules to existing passwords", () => {
    expect(signInSchema.safeParse({ email: "a@b.co", password: "x" }).success).toBe(true);
    expect(signInSchema.safeParse({ email: "a@b.co", password: "" }).success).toBe(false);
  });
});

describe("newPasswordSchema", () => {
  it("requires matching passwords", () => {
    const result = newPasswordSchema.safeParse({ password: "secret123", confirmPassword: "secret124" });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["confirmPassword"]);
  });
});

describe("emailOtpTypeSchema", () => {
  it("accepts Supabase email link types only", () => {
    expect(emailOtpTypeSchema.safeParse("recovery").success).toBe(true);
    expect(emailOtpTypeSchema.safeParse("sms").success).toBe(false);
  });
});
