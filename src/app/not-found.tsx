import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto grid max-w-md gap-3 px-4 py-16 text-center">
      <h1 className="text-2xl font-bold">Page not found</h1>
      <p className="text-muted-foreground">This page does not exist or you do not have access to it.</p>
      <Link href="/" className="text-primary underline">Go to the home page</Link>
    </div>
  );
}
