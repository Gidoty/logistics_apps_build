import { NextResponse, type NextRequest } from "next/server";
import { safeRedirectPath } from "@/lib/auth/redirect";
import { emailOtpTypeSchema } from "@/lib/auth/schemas";
import { createClient } from "@/lib/supabase/server";

/**
 * Finishes every email link and OAuth sign-in:
 * - `code`: PKCE flow (default email templates, magic links, Google)
 * - `token_hash` + `type`: custom email templates that link here directly
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const next = safeRedirectPath(searchParams.get("next"));
  const failure = NextResponse.redirect(new URL("/login?error=link_invalid", origin));

  const supabase = await createClient();
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = emailOtpTypeSchema.safeParse(searchParams.get("type"));

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) return failure;
  } else if (tokenHash && type.success) {
    const { error } = await supabase.auth.verifyOtp({ type: type.data, token_hash: tokenHash });
    if (error) return failure;
  } else {
    return failure;
  }

  return NextResponse.redirect(new URL(next, origin));
}
