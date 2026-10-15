import { Skeleton } from "@/components/ui/skeleton";

export default function OrdersLoading() {
  return (
    <main className="page-container flex flex-1 flex-col gap-section py-section" aria-busy="true">
      <span className="sr-only">Loading orders…</span>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-9 w-40" />
        <Skeleton className="h-5 w-56" />
      </div>
      <div className="flex flex-col gap-component">
        <Skeleton className="h-11 w-full" />
        <div className="grid grid-cols-1 gap-2 xs:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-11 w-full" />
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-component">
        {Array.from({ length: 5 }, (_, index) => (
          <Skeleton key={index} className="h-24 w-full rounded-xl" />
        ))}
      </div>
    </main>
  );
}
