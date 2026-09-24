/**
 * Gives the admin role to an existing account. The person must sign up first.
 *
 *   npm run grant-admin -- someone@example.com
 *
 * Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local.
 * This is the only way to create the first admin. After that, admins can
 * grant roles from the /admin page.
 */
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "../src/lib/supabase/database.types";

const env = z
  .object({
    NEXT_PUBLIC_SUPABASE_URL: z.url(),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  })
  .parse(process.env);

const email = z.email().parse(process.argv[2]?.trim().toLowerCase());

async function main(): Promise<void> {
  const supabase = createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("id, email")
    .ilike("email", email)
    .maybeSingle();
  if (error) throw new Error(`Lookup failed: ${error.message}`);
  if (!profile) throw new Error(`No account found for ${email}. Sign up in the app first.`);

  const { error: insertError } = await supabase
    .from("user_roles")
    .upsert({ user_id: profile.id, role: "admin" }, { onConflict: "user_id,role", ignoreDuplicates: true });
  if (insertError) throw new Error(`Could not grant admin: ${insertError.message}`);

  console.log(`${profile.email} is now an admin.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
