import { Skeleton } from '@/components/ui/skeleton';
import { cn }       from '@/lib/utils';

export default function DashboardLoading() {
  return (
    <div className="flex h-full flex-col gap-4">
      {/* Header skeleton */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-3">
          <Skeleton className="size-9 rounded-lg" />
          <div className="space-y-1.5">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-4 w-40" />
          </div>
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-8 w-[180px]" />
          <Skeleton className="h-8 w-[180px]" />
        </div>
      </div>

      {/* KPI tiles skeleton */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-20 rounded-xl" />
        ))}
      </div>

      {/* Chart-card grid skeleton */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {([false, false, true, false, false] as boolean[]).map((wide, i) => (
          <Skeleton
            key={i}
            className={cn('h-[300px] rounded-xl', wide && 'lg:col-span-2')}
          />
        ))}
      </div>
    </div>
  );
}
