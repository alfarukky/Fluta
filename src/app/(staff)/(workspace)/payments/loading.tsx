import { Skeleton } from "@/components/ui/skeleton";

export default function PaymentsLoading() {
  return (
    <main className="page-container flex flex-1 flex-col gap-section py-section" aria-busy="true">
      <span className="sr-only">Loading payments…</span>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-9 w-40" />
        <Skeleton className="h-5 w-72" />
      </div>
      <div className="grid grid-cols-1 gap-2 xs:grid-cols-3">
        {Array.from({ length: 3 }, (_, index) => (
          <Skeleton key={index} className="h-11 w-full" />
        ))}
      </div>
      <div className="flex flex-col gap-component">
        {Array.from({ length: 5 }, (_, index) => (
          <Skeleton key={index} className="h-24 w-full rounded-xl" />
        ))}
      </div>
    </main>
  );
}
