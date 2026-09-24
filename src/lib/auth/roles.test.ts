import { describe, expect, it } from "vitest";
import { hasRole, isAppRole, normalizeRoles } from "./roles";

describe("roles", () => {
  it("recognizes only known roles", () => {
    expect(isAppRole("admin")).toBe(true);
    expect(isAppRole("recipient")).toBe(false);
    expect(isAppRole(1)).toBe(false);
  });

  it("checks role membership", () => {
    expect(hasRole(["buyer", "vendor"], "vendor")).toBe(true);
    expect(hasRole(["buyer"], "admin")).toBe(false);
  });

  it("normalizes roles: drops unknowns and duplicates, keeps a stable order", () => {
    expect(normalizeRoles(["admin", "buyer", "admin", "superuser"])).toEqual(["buyer", "admin"]);
    expect(normalizeRoles([])).toEqual([]);
  });
});
