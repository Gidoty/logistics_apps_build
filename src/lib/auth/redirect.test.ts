import { describe, expect, it } from "vitest";
import { DEFAULT_AFTER_SIGN_IN, safeRedirectPath, signInPathFor } from "./redirect";

describe("safeRedirectPath", () => {
  it.each([
    ["/account", "/account"],
    ["/admin?q=ada", "/admin?q=ada"],
    ["/orders/123#timeline", "/orders/123#timeline"],
    ["/a/../admin", "/admin"],
  ])("keeps same-site path %s", (input, expected) => {
    expect(safeRedirectPath(input)).toBe(expected);
  });

  it.each([
    ["protocol-relative", "//evil.example"],
    ["backslash host", "/\\evil.example"],
    ["embedded backslash", "/foo\\bar"],
    ["absolute URL", "https://evil.example/account"],
    ["javascript URL", "javascript:alert(1)"],
    ["relative path", "account"],
    ["tab trick", "/\t/evil.example"],
    ["newline", "/account\n"],
    ["empty", ""],
    ["too long", `/${"a".repeat(600)}`],
  ])("rejects %s", (_label, input) => {
    expect(safeRedirectPath(input)).toBe(DEFAULT_AFTER_SIGN_IN);
  });

  it("rejects non-strings and uses the given fallback", () => {
    expect(safeRedirectPath(undefined)).toBe(DEFAULT_AFTER_SIGN_IN);
    expect(safeRedirectPath(["/admin"], "/")).toBe("/");
    expect(safeRedirectPath(null, "/home")).toBe("/home");
  });
});

describe("signInPathFor", () => {
  it("adds an encoded next parameter", () => {
    expect(signInPathFor("/admin?q=a b")).toBe("/sign-in?next=%2Fadmin%3Fq%3Da%2520b");
  });

  it("omits next for the default destination and for unsafe paths", () => {
    expect(signInPathFor("/account")).toBe("/sign-in");
    expect(signInPathFor("//evil.example")).toBe("/sign-in");
  });
});
