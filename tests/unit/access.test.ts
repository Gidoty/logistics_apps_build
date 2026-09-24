import { describe, expect, it } from "vitest";
import { decideAccess, requirementFor, type AccessContext } from "@/lib/auth/access";

const anonymous: AccessContext = { signedIn: false, role: null, vendorStatus: null };
const buyer: AccessContext = { signedIn: true, role: "buyer", vendorStatus: null };
const pendingVendor: AccessContext = { signedIn: true, role: "buyer", vendorStatus: "pending" };
const vendor: AccessContext = { signedIn: true, role: "vendor", vendorStatus: "approved" };
const suspendedVendor: AccessContext = { signedIn: true, role: "vendor", vendorStatus: "suspended" };
const admin: AccessContext = { signedIn: true, role: "admin", vendorStatus: null };

describe("requirementFor", () => {
  it.each([
    ["/", "public"],
    ["/login", "public"],
    ["/unauthorized", "public"],
    ["/account", "user"],
    ["/account/become-vendor", "user"],
    ["/vendor", "vendor"],
    ["/vendor/products", "vendor"],
    ["/admin", "admin"],
    ["/admin/vendors/123", "admin"],
    // Prefix must match a whole path segment.
    ["/administrator", "public"],
    ["/vendors", "public"],
    ["/accounting", "public"],
  ] as const)("%s needs %s", (path, expected) => {
    expect(requirementFor(path)).toBe(expected);
  });
});

describe("decideAccess", () => {
  it("allows public pages for everyone", () => {
    expect(decideAccess("public", anonymous)).toBe("allow");
  });

  it("sends signed-out visitors to login for every protected area", () => {
    expect(decideAccess("user", anonymous)).toBe("login");
    expect(decideAccess("vendor", anonymous)).toBe("login");
    expect(decideAccess("admin", anonymous)).toBe("login");
  });

  it("lets any signed-in user into /account", () => {
    for (const ctx of [buyer, pendingVendor, vendor, admin]) {
      expect(decideAccess("user", ctx)).toBe("allow");
    }
  });

  it("allows /vendor only for the vendor role with an approved record", () => {
    expect(decideAccess("vendor", vendor)).toBe("allow");
    expect(decideAccess("vendor", buyer)).toBe("unauthorized");
    expect(decideAccess("vendor", pendingVendor)).toBe("unauthorized");
    expect(decideAccess("vendor", suspendedVendor)).toBe("unauthorized");
    expect(decideAccess("vendor", { signedIn: true, role: "vendor", vendorStatus: null })).toBe(
      "unauthorized",
    );
    expect(decideAccess("vendor", admin)).toBe("unauthorized");
  });

  it("allows /admin only for admins", () => {
    expect(decideAccess("admin", admin)).toBe("allow");
    expect(decideAccess("admin", buyer)).toBe("unauthorized");
    expect(decideAccess("admin", vendor)).toBe("unauthorized");
  });
});
