import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { APP_NAME } from "@/lib/config/app";

const POINTS = [
  {
    title: "Verified sellers",
    body: "Buy from checked vendors in Nigeria and China, or send us a link from any store.",
  },
  {
    title: "One price before you pay",
    body: "Item, shipping, customs and delivery in one total, in your currency.",
  },
  {
    title: "Your money is protected",
    body: "The seller is paid only after your recipient confirms delivery.",
  },
];

export default function HomePage() {
  return (
    <div className="mx-auto grid max-w-5xl gap-10 px-4 py-10">
      <section className="grid gap-4">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
          Shop anywhere. Deliver to anyone in Nigeria.
        </h1>
        <p className="text-muted-foreground max-w-prose">
          {APP_NAME} lets you pay in your own currency for electronics and everyday goods, with delivery to
          family, friends or your business in Nigeria.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link href="/signup" className={buttonVariants({ size: "lg" })}>
            Create a free account
          </Link>
          <Link href="/login" className={buttonVariants({ size: "lg", variant: "outline" })}>
            Sign in
          </Link>
        </div>
      </section>
      <section className="grid gap-4 sm:grid-cols-3">
        {POINTS.map((point) => (
          <div key={point.title} className="rounded-lg border p-4">
            <h2 className="font-semibold">{point.title}</h2>
            <p className="text-muted-foreground mt-1 text-sm">{point.body}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
