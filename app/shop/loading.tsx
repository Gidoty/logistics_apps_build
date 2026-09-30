import { ProductGridSkeleton } from "@/components/shop/skeletons";
import { Skeleton } from "@/components/ui/skeleton";

export default function ShopLoading() {
  return (
    <div className="mx-auto grid max-w-5xl gap-5 px-4 py-6" aria-busy="true">
      <div className="grid gap-2">
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-4 w-3/4" />
      </div>
      <Skeleton className="h-10 w-full" />
      <ProductGridSkeleton />
    </div>
  );
}
