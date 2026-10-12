import { Skeleton } from "@/components/ui/skeleton";

export function OrderDetailSkeleton() {
  return (
    <main className="page-container flex flex-1 flex-col gap-section py-section" aria-busy="true">
      <span className="sr-only">Loading order…</span>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-9 w-48" />
        <Skeleton className="h-5 w-40" />
        <div className="flex gap-2">
          <Skeleton className="h-6 w-28 rounded-full" />
          <Skeleton className="h-6 w-24 rounded-full" />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-grid lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="flex flex-col gap-grid">
          <Skeleton className="h-72 w-full rounded-xl" />
          <Skeleton className="h-40 w-full rounded-xl" />
        </div>
        <div className="flex flex-col gap-grid">
          <Skeleton className="h-40 w-full rounded-xl" />
          <Skeleton className="h-56 w-full rounded-xl" />
        </div>
      </div>
    </main>
  );
}
