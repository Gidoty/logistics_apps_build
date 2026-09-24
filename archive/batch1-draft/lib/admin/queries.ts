import "server-only";
import { normalizeRoles, type AppRole } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { toSearchPattern } from "./search";

export type AdminUserRow = {
  id: string;
  email: string | null;
  fullName: string;
  countryCode: string | null;
  createdAt: string;
  roles: AppRole[];
};

export const ADMIN_USER_PAGE_SIZE = 50;

/** Lists users for the admin role screen. RLS limits this to admins. */
export async function listUsersWithRoles(search: unknown): Promise<AdminUserRow[]> {
  const supabase = await createClient();
  let query = supabase
    .from("profiles")
    .select("id, email, full_name, country_code, created_at, user_roles!user_roles_user_id_fkey(role)")
    .order("created_at", { ascending: false })
    .limit(ADMIN_USER_PAGE_SIZE);

  const pattern = toSearchPattern(search);
  if (pattern) {
    query = query.or(`email.ilike.${pattern},full_name.ilike.${pattern}`);
  }

  const { data, error } = await query;
  if (error) throw new Error(`Could not load users: ${error.message}`);

  return data.map((row) => ({
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    countryCode: row.country_code,
    createdAt: row.created_at,
    roles: normalizeRoles(row.user_roles.map((r) => r.role)),
  }));
}
