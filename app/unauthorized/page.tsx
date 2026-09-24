import type { Metadata } from "next";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

export const metadata: Metadata = { title: "No access" };

export default function UnauthorizedPage() {
  return (
    <div className="mx-auto grid max-w-md gap-4 px-4 py-16 text-center">
      <h1 className="text-2xl font-bold">You do not have access to this page</h1>
      <p className="text-muted-foreground">
        This area is for approved vendors or the operations team. If you think you should have access, contact
        support.
      </p>
      <div className="flex justify-center gap-3">
        <Link href="/account" className={buttonVariants()}>
          Go to your account
        </Link>
        <Link href="/" className={buttonVariants({ variant: "outline" })}>
          Home
        </Link>
      </div>
    </div>
  );
}
