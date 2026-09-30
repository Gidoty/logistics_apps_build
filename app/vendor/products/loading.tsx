import { Skeleton } from "@/components/ui/skeleton";

export default function VendorProductsLoading() {
  return (
    <div className="mx-auto grid max-w-3xl gap-3 px-4 py-8" aria-busy="true">
      <Skeleton className="h-8 w-40" />
      {Array.from({ length: 4 }, (_, index) => (
        <Skeleton key={index} className="h-20 w-full" />
      ))}
    </div>
  );
}
