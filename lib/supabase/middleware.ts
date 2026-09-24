import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { AccessContext } from "@/lib/auth/access";
import { getPublicEnv } from "@/lib/env";
import type { Database } from "./database.types";

/**
 * Refreshes the Supabase session cookie and returns the response to send.
 * When `loadRole` is true it also reads the user's role and vendor status,
 * for routes that need more than "signed in".
 */
export async function updateSession(
  request: NextRequest,
  { loadRole }: { loadRole: boolean },
): Promise<{ response: NextResponse; access: AccessContext }> {
  const env = getPublicEnv();
  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
          for (const [key, value] of Object.entries(headers)) {
            response.headers.set(key, value);
          }
        },
      },
    },
  );

  // Do not add code between client creation and getClaims(): it refreshes
  // the session and validates the JWT.
  const { data } = await supabase.auth.getClaims();
  const userId = typeof data?.claims.sub === "string" ? data.claims.sub : null;

  const access: AccessContext = { signedIn: userId !== null, role: null, vendorStatus: null };
  if (userId && loadRole) {
    const [profile, vendor] = await Promise.all([
      supabase.from("profiles").select("role").eq("id", userId).maybeSingle(),
      supabase.from("vendors").select("status").eq("owner_id", userId).maybeSingle(),
    ]);
    access.role = profile.data?.role ?? null;
    access.vendorStatus = vendor.data?.status ?? null;
  }

  return { response, access };
}
