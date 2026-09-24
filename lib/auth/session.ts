import "server-only";
import { redirect } from "next/navigation";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { decideAccess, type AccessRequirement } from "./access";
import { loginPathFor, UNAUTHORIZED_PATH } from "./redirect";
import type { UserRole, VendorStatus } from "./roles";

export type SessionUser = {
  id: string;
  email: string | null;
  role: UserRole;
  vendor: { id: string; status: VendorStatus } | null;
};

/**
 * Returns the signed-in user with role and vendor record, or null.
 * getClaims() verifies the JWT. Role and vendor status come from the
 * database, so changes take effect on the next request. Cached per request.
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (error || !claims || typeof claims.sub !== "string") return null;

  const [profileResult, vendorResult] = await Promise.all([
    supabase.from("profiles").select("role, email").eq("id", claims.sub).maybeSingle(),
    supabase.from("vendors").select("id, status").eq("owner_id", claims.sub).maybeSingle(),
  ]);
  if (profileResult.error) throw new Error(`Could not load profile: ${profileResult.error.message}`);
  if (vendorResult.error) throw new Error(`Could not load vendor: ${vendorResult.error.message}`);
  // A valid token without a profile row means the account is being deleted.
  if (!profileResult.data) return null;

  return {
    id: claims.sub,
    email: profileResult.data.email,
    role: profileResult.data.role,
    vendor: vendorResult.data,
  };
});

/** Enforces an access rule on the server. Redirects to login or /unauthorized. */
async function requireAccess(requirement: AccessRequirement, returnTo: string): Promise<SessionUser> {
  const user = await getSessionUser();
  const decision = decideAccess(requirement, {
    signedIn: user !== null,
    role: user?.role ?? null,
    vendorStatus: user?.vendor?.status ?? null,
  });
  if (decision === "login" || !user) redirect(loginPathFor(returnTo));
  if (decision === "unauthorized") redirect(UNAUTHORIZED_PATH);
  return user;
}

export function requireUser(returnTo: string): Promise<SessionUser> {
  return requireAccess("user", returnTo);
}

export function requireApprovedVendor(returnTo: string): Promise<SessionUser> {
  return requireAccess("vendor", returnTo);
}

export function requireAdmin(returnTo: string): Promise<SessionUser> {
  return requireAccess("admin", returnTo);
}
