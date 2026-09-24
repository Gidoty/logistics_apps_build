import { describe, expect, it } from "vitest";
import { isUserRole, USER_ROLES } from "@/lib/auth/roles";

describe("roles", () => {
  it("matches the database enum", () => {
    expect(USER_ROLES).toEqual(["buyer", "vendor", "admin"]);
  });

  it("recognizes only known roles", () => {
    expect(isUserRole("admin")).toBe(true);
    expect(isUserRole("recipient")).toBe(false);
    expect(isUserRole(1)).toBe(false);
  });
});
