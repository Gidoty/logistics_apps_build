import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getPublicEnv } from "@/lib/env";
import type { Database } from "./database.types";

/**
 * Supabase client that always acts as a logged-out visitor (the anon role), no
 * matter who is signed in. The public shop uses it so it shows exactly what a
 * visitor sees: an admin browsing /shop must not see hidden products from
 * suspended vendors. No cookies are read or written.
 */
export function createPublicClient() {
  const env = getPublicEnv();
  return createSupabaseClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
