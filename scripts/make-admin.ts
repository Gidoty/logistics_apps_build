/**
 * Promotes an existing account to admin. The person must sign up first.
 *
 *   npm run make-admin -- someone@example.com
 *
 * Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local.
 * Uses the service role key, so it bypasses RLS. The role change is written
 * to audit_log by a database trigger. No admin account is hardcoded anywhere.
 */
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "../lib/supabase/database.types";

const env = z
  .object({
    NEXT_PUBLIC_SUPABASE_URL: z.url(),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  })
  .safeParse(process.env);

const email = z.email().safeParse(process.argv[2]?.trim().toLowerCase());

async function main(): Promise<void> {
  if (!env.success) {
    throw new Error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local.");
  }
  if (!email.success) {
    throw new Error("Usage: npm run make-admin -- someone@example.com");
  }

  const supabase = createClient<Database>(
    env.data.NEXT_PUBLIC_SUPABASE_URL,
    env.data.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("id, email, role")
    .ilike("email", email.data)
    .maybeSingle();
  if (error) throw new Error(`Lookup failed: ${error.message}`);
  if (!profile) throw new Error(`No account found for ${email.data}. Sign up in the app first.`);

  if (profile.role === "admin") {
    console.log(`${profile.email} is already an admin.`);
    return;
  }
  if (profile.role === "vendor") {
    console.warn(`Note: ${profile.email} is a vendor. As an admin they lose access to /vendor.`);
  }

  const { error: updateError } = await supabase
    .from("profiles")
    .update({ role: "admin" })
    .eq("id", profile.id);
  if (updateError) throw new Error(`Could not promote: ${updateError.message}`);

  console.log(`${profile.email} is now an admin. Log out and back in, then open /admin.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
