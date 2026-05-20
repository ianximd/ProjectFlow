import { Skeleton } from '@/components/ui/skeleton';

export default function ProfileSettingsLoading() {
  return (
    <div className="flex h-full flex-col gap-4">
      {/* Page header skeleton */}
      <div className="flex items-center gap-3">
        <Skeleton className="size-9 rounded-lg" />
        <div className="space-y-1.5">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-4 w-24" />
        </div>
      </div>

      {/* Cards grid skeleton */}
      <div className="grid gap-4 md:grid-cols-2 max-w-5xl">
        {/* Profile card */}
        <div className="rounded-xl border bg-card p-6 space-y-4">
          <Skeleton className="h-4 w-36" />
          <div className="flex items-center gap-3">
            <Skeleton className="size-14 rounded-full" />
            <div className="space-y-1.5">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-3 w-40" />
            </div>
          </div>
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>

        {/* Password card */}
        <div className="rounded-xl border bg-card p-6 space-y-4">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-24 ml-auto" />
        </div>

        {/* Security card */}
        <div className="rounded-xl border bg-card p-6 space-y-4">
          <Skeleton className="h-4 w-40" />
          <div className="flex items-center justify-between">
            <Skeleton className="h-4 w-12" />
            <Skeleton className="h-5 w-20" />
          </div>
          <Skeleton className="h-3 w-full" />
        </div>

        {/* Connected accounts card */}
        <div className="rounded-xl border bg-card p-6 space-y-4">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-4 w-56" />
          <Skeleton className="h-9 w-36" />
        </div>
      </div>
    </div>
  );
}
