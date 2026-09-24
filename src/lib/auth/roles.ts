import type { Enums } from "@/lib/supabase/database.types";

export type AppRole = Enums<"app_role">;

export const APP_ROLES = ["buyer", "vendor", "admin"] as const satisfies readonly AppRole[];

export const ROLE_LABELS: Record<AppRole, string> = {
  buyer: "Buyer",
  vendor: "Vendor",
  admin: "Admin",
};

export function isAppRole(value: unknown): value is AppRole {
  return typeof value === "string" && (APP_ROLES as readonly string[]).includes(value);
}

export function hasRole(roles: readonly AppRole[], role: AppRole): boolean {
  return roles.includes(role);
}

/** Keeps known roles only, removes duplicates and sorts in APP_ROLES order. */
export function normalizeRoles(values: readonly unknown[]): AppRole[] {
  return APP_ROLES.filter((role) => values.includes(role));
}
