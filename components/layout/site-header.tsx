import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { signOut } from "@/lib/auth/actions";
import { getSessionUser } from "@/lib/auth/session";
import { APP_NAME } from "@/lib/config/app";

export async function SiteHeader() {
  const user = await getSessionUser();
  const isAdmin = user?.role === "admin";
  const isVendor = user?.role === "vendor" && user.vendor?.status === "approved";

  return (
    <header className="border-b">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-2 px-4">
        <Link href="/" className="text-primary text-lg font-bold tracking-tight">
          {APP_NAME}
        </Link>
        <nav className="flex items-center gap-1 text-sm">
          {user ? (
            <>
              {isVendor ? (
                <Link href="/vendor" className={buttonVariants({ variant: "ghost", size: "sm" })}>
                  Vendor
                </Link>
              ) : null}
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
                  Log out
                </button>
              </form>
            </>
          ) : (
            <>
              <Link href="/login" className={buttonVariants({ variant: "ghost", size: "sm" })}>
                Log in
              </Link>
              <Link href="/signup" className={buttonVariants({ size: "sm" })}>
                Sign up
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
