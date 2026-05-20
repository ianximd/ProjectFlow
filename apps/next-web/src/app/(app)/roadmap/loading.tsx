import { Skeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <div className="flex h-full flex-col gap-4">
      {/* Header */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-3">
          <Skeleton className="size-9 rounded-lg" />
          <div className="flex flex-col gap-1.5">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-5 w-40" />
          </div>
        </div>
        <Skeleton className="h-8 w-48 rounded-md" />
      </div>

      {/* Chart area */}
      <div className="flex-1 min-h-0">
        <div className="h-full rounded-xl border border-border overflow-hidden">
          <div className="grid grid-cols-[260px_1fr] h-full">
            {/* Left sidebar */}
            <div className="border-r border-border p-4 flex flex-col gap-3">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="flex items-center gap-2">
                  <Skeleton className="size-5 rounded" />
                  <Skeleton className="h-4 flex-1" />
                </div>
              ))}
            </div>
            {/* Timeline */}
            <div className="p-4 flex flex-col gap-3">
              <div className="flex gap-2 mb-2">
                {[0, 1, 2, 3, 4, 5, 6].map((i) => (
                  <Skeleton key={i} className="h-4 flex-1" />
                ))}
              </div>
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <Skeleton
                  key={i}
                  className="h-5"
                  style={{ width: `${40 + i * 8}%`, marginLeft: `${i * 15}px` }}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
