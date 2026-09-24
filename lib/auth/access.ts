import type { UserRole, VendorStatus } from "./roles";

/**
 * Route access rules, shared by the proxy (first check) and by pages
 * (authoritative check on the server).
 *   /account/*  any signed-in user
 *   /vendor/*   vendor role with an approved vendor record
 *   /admin/*    admin role
 */
export type AccessRequirement = "public" | "user" | "vendor" | "admin";

export type AccessContext = {
  signedIn: boolean;
  role: UserRole | null;
  vendorStatus: VendorStatus | null;
};

export type AccessDecision = "allow" | "login" | "unauthorized";

const RULES: ReadonlyArray<[prefix: string, requirement: AccessRequirement]> = [
  ["/admin", "admin"],
  ["/vendor", "vendor"],
  ["/account", "user"],
];

function matchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function requirementFor(pathname: string): AccessRequirement {
  const rule = RULES.find(([prefix]) => matchesPrefix(pathname, prefix));
  return rule ? rule[1] : "public";
}

export function decideAccess(requirement: AccessRequirement, context: AccessContext): AccessDecision {
  if (requirement === "public") return "allow";
  if (!context.signedIn) return "login";

  switch (requirement) {
    case "user":
      return "allow";
    case "vendor":
      return context.role === "vendor" && context.vendorStatus === "approved" ? "allow" : "unauthorized";
    case "admin":
      return context.role === "admin" ? "allow" : "unauthorized";
  }
}
