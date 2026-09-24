import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { signOut } from "@/lib/auth/actions";
import { getSessionUser } from "@/lib/auth/session";
import { APP_NAME } from "@/lib/config/app";

export async function SiteHeader() {
  const user = await getSessionUser();
  const isAdmin = user?.roles.includes("admin") ?? false;

  return (
    <header className="border-b">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-2 px-4">
        <Link href="/" className="text-lg font-bold tracking-tight text-primary">
          {APP_NAME}
        </Link>
        <nav className="flex items-center gap-1 text-sm">
          {user ? (
            <>
              {isAdmin ? (
                <Link href="/admin" className={buttonVariants({ variant: "ghost", size: "sm" })}>
                  Admin
                </Link>
              ) : null}
              <Link href="/account" className={buttonVariants({ variant: "ghost", size: "sm" })}>
                Account
              </Link>
              <form action={signOut}>
                <button type="submit" className={buttonVariants({ variant: "outline", size: "sm" })}>
                  Sign out
                </button>
              </form>
            </>
          ) : (
            <>
              <Link href="/sign-in" className={buttonVariants({ variant: "ghost", size: "sm" })}>
                Sign in
              </Link>
              <Link href="/sign-up" className={buttonVariants({ size: "sm" })}>
                Create account
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
