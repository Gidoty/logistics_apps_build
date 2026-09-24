import "server-only";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { normalizeRoles, type AppRole } from "./roles";
import { signInPathFor } from "./redirect";

export type SessionUser = {
  id: string;
  email: string | null;
  roles: AppRole[];
};

/**
 * Returns the signed-in user with their roles, or null.
 * The JWT is verified by getClaims(). Roles come from the database (not the
 * token), so a revoked role takes effect on the next request.
 * Cached per request.
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (error || !claims || typeof claims.sub !== "string") return null;

  const { data: roleRows, error: rolesError } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", claims.sub);
  if (rolesError) throw new Error(`Could not load roles: ${rolesError.message}`);

  return {
    id: claims.sub,
    email: typeof claims.email === "string" ? claims.email : null,
    roles: normalizeRoles((roleRows ?? []).map((row) => row.role)),
  };
});

/** Redirects to sign-in when nobody is signed in. */
export async function requireUser(returnTo: string): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect(signInPathFor(returnTo));
  return user;
}

/**
 * Requires a signed-in user with the given role. Users without it get a 404,
 * so the page does not reveal that it exists.
 */
export async function requireRole(role: AppRole, returnTo: string): Promise<SessionUser> {
  const user = await requireUser(returnTo);
  if (!user.roles.includes(role)) notFound();
  return user;
}
