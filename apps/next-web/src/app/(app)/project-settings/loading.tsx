import { Skeleton } from '@/components/ui/skeleton';

export default function ProjectSettingsLoading() {
  return (
    <div className="flex h-full flex-col gap-4">
      {/* Header placeholder */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Skeleton className="size-9 rounded-lg" />
          <div className="flex flex-col gap-1.5">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-5 w-40" />
          </div>
        </div>
        <Skeleton className="h-8 w-[180px] rounded-md" />
      </div>

      {/* Tab bar */}
      <Skeleton className="h-9 w-[420px] rounded-md" />

      {/* Filter bar */}
      <Skeleton className="h-10 w-full rounded-lg" />

      {/* Rows */}
      <div className="flex flex-col gap-2">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-12 w-full rounded-md" />
        ))}
      </div>
    </div>
  );
}
