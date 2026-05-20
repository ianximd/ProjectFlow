import { Skeleton } from '@/components/ui/skeleton';

export default function EpicsLoading() {
  return (
    <div className="flex h-full flex-col gap-4">
      {/* Header */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-3">
          <Skeleton className="size-9 rounded-lg" />
          <div className="flex flex-col gap-1.5">
            <Skeleton className="h-3 w-24 rounded" />
            <Skeleton className="h-5 w-40 rounded" />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-8 w-[180px] rounded-md" />
          <Skeleton className="h-8 w-[180px] rounded-md" />
          <Skeleton className="h-8 w-24 rounded-md" />
        </div>
      </div>

      {/* KPI tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-20 rounded-xl" />
        ))}
      </div>

      {/* Filter bar */}
      <Skeleton className="h-12 w-full rounded-lg" />

      {/* Epic grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className="h-28 rounded-xl" />
        ))}
      </div>
    </div>
  );
}
