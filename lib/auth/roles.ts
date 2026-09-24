import { Constants, type Enums } from "@/lib/supabase/database.types";

export type UserRole = Enums<"user_role">;
export type VendorStatus = Enums<"vendor_status">;

export const USER_ROLES = Constants.public.Enums.user_role;

export const ROLE_LABELS: Record<UserRole, string> = {
  buyer: "Buyer",
  vendor: "Vendor",
  admin: "Admin",
};

export const VENDOR_STATUS_LABELS: Record<VendorStatus, string> = {
  pending: "Waiting for approval",
  approved: "Approved",
  suspended: "Suspended",
};

export function isUserRole(value: unknown): value is UserRole {
  return typeof value === "string" && (USER_ROLES as readonly string[]).includes(value);
}
