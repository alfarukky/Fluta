import { Skeleton } from "@/components/ui/skeleton";

export default function ReviewsLoading() {
  return (
    <main className="page-container flex flex-1 flex-col gap-section py-section" aria-busy="true">
      <span className="sr-only">Loading reviews…</span>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-9 w-40" />
        <Skeleton className="h-5 w-72" />
      </div>
      <div className="grid grid-cols-1 gap-grid xs:grid-cols-2">
        <Skeleton className="h-28 w-full rounded-xl" />
        <Skeleton className="h-28 w-full rounded-xl" />
      </div>
      <Skeleton className="h-11 w-full xs:max-w-60" />
      <div className="flex flex-col gap-component">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-32 w-full rounded-xl" />
        ))}
      </div>
    </main>
  );
}
