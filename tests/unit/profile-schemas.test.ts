import { describe, expect, it } from "vitest";
import { profileUpdateSchema } from "@/lib/profile/schemas";

describe("profileUpdateSchema", () => {
  it("normalizes phone, country and currency", () => {
    expect(
      profileUpdateSchema.parse({
        fullName: " Ada Obi ",
        phone: "+234 803 123 4567",
        countryCode: "ng",
        preferredCurrency: "usd",
      }),
    ).toEqual({ fullName: "Ada Obi", phone: "+2348031234567", countryCode: "NG", preferredCurrency: "USD" });
  });

  it("treats empty phone and country as not set", () => {
    const result = profileUpdateSchema.parse({
      fullName: "Ada Obi",
      phone: "  ",
      countryCode: "",
      preferredCurrency: "NGN",
    });
    expect(result.phone).toBeNull();
    expect(result.countryCode).toBeNull();
  });

  it("reports a clear error for local phone formats", () => {
    const result = profileUpdateSchema.safeParse({
      fullName: "Ada Obi",
      phone: "08031234567",
      countryCode: "NG",
      preferredCurrency: "NGN",
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["phone"]);
    expect(result.error?.issues[0]?.message).toMatch(/international format/);
  });
});
