import { NextResponse, type NextRequest } from "next/server";
import { signInPathFor } from "@/lib/auth/redirect";
import { updateSession } from "@/lib/supabase/proxy";

/** Paths that need a signed-in user. Pages still check roles on the server. */
const PROTECTED_PREFIXES = ["/account", "/admin"];

function isProtected(pathname: string): boolean {
  return PROTECTED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export async function proxy(request: NextRequest) {
  const { response, userId } = await updateSession(request);

  if (!userId && isProtected(request.nextUrl.pathname)) {
    const { pathname, search } = request.nextUrl;
    const redirect = NextResponse.redirect(new URL(signInPathFor(`${pathname}${search}`), request.url));
    // Carry over any cookie changes (for example a cleared expired session).
    for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
    return redirect;
  }

  return response;
}

export const config = {
  matcher: [
    // Skip static files and images.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|webmanifest)$).*)",
  ],
};
