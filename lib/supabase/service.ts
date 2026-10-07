import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getPublicEnv, getServerEnv } from "@/lib/env";
import type { Database } from "./database.types";

/**
 * Supabase client with the service role key: it bypasses row security.
 * Use it only in server code, only for work that browser sessions are not
 * allowed to do (for example saving a link preview, or changing an order
 * status through transitionOrder), and only after the caller has been checked.
 * Never pass it to client components.
 */
export function createServiceClient() {
  return createSupabaseClient<Database>(
    getPublicEnv().NEXT_PUBLIC_SUPABASE_URL,
    getServerEnv().SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    },
  );
}
