import { describe, expect, it } from "vitest";
import { roleChangeSchema } from "./schemas";
import { toSearchPattern } from "./search";

describe("toSearchPattern", () => {
  it("wraps cleaned input in wildcards", () => {
    expect(toSearchPattern("  ada@example.com ")).toBe("%ada@example.com%");
    expect(toSearchPattern("Chidi  O'Neil")).toBe("%Chidi O'Neil%");
  });

  it("drops characters that could break a PostgREST filter", () => {
    expect(toSearchPattern('a"),role.eq.admin,(b')).toBe("%arole.eq.adminb%");
    expect(toSearchPattern("x\\y*z")).toBe("%xyz%");
  });

  it("returns null for empty or non-string input", () => {
    expect(toSearchPattern("   ")).toBeNull();
    expect(toSearchPattern('",()')).toBeNull();
    expect(toSearchPattern(undefined)).toBeNull();
    expect(toSearchPattern(["a"])).toBeNull();
  });

  it("caps length", () => {
    expect(toSearchPattern("a".repeat(500))?.length).toBe(102);
  });
});

describe("roleChangeSchema", () => {
  it("accepts a valid change and rejects unknown roles or intents", () => {
    const userId = "6f1c2c8e-8a4b-4f7e-9d3a-2b1e5c7d9f00";
    expect(roleChangeSchema.safeParse({ userId, role: "vendor", intent: "grant" }).success).toBe(true);
    expect(roleChangeSchema.safeParse({ userId, role: "owner", intent: "grant" }).success).toBe(false);
    expect(roleChangeSchema.safeParse({ userId, role: "admin", intent: "delete" }).success).toBe(false);
    expect(roleChangeSchema.safeParse({ userId: "1", role: "admin", intent: "grant" }).success).toBe(false);
  });
});
