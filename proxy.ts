import { NextResponse, type NextRequest } from "next/server";
import { decideAccess, requirementFor } from "@/lib/auth/access";
import { loginPathFor, UNAUTHORIZED_PATH } from "@/lib/auth/redirect";
import { updateSession } from "@/lib/supabase/middleware";

/**
 * Next.js 16 name for middleware. Refreshes the session and blocks routes
 * the user may not open. Pages repeat the check on the server.
 */
export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const requirement = requirementFor(pathname);
  const { response, access } = await updateSession(request, {
    loadRole: requirement === "vendor" || requirement === "admin",
  });

  const decision = decideAccess(requirement, access);
  if (decision === "allow") return response;

  const target = decision === "login" ? loginPathFor(`${pathname}${search}`) : UNAUTHORIZED_PATH;
  const redirect = NextResponse.redirect(new URL(target, request.url));
  // Carry over cookie changes (for example a refreshed or cleared session).
  for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
  return redirect;
}

export const config = {
  matcher: [
    // Skip static files and images.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|webmanifest)$).*)",
  ],
};
