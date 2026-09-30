import { Skeleton } from "@/components/ui/skeleton";

export default function ProductLoading() {
  return (
    <div className="mx-auto grid max-w-5xl gap-6 px-4 py-6 md:grid-cols-2" aria-busy="true">
      <Skeleton className="aspect-square w-full rounded-lg" />
      <div className="grid content-start gap-3">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-9 w-1/2" />
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    </div>
  );
}
