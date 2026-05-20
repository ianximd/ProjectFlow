import { Skeleton } from '@/components/ui/skeleton';

export default function ConnectedAccountsLoading() {
  return (
    <div className="max-w-2xl p-6 space-y-6">
      {/* Page header skeleton */}
      <div className="space-y-1.5">
        <Skeleton className="h-6 w-44" />
        <Skeleton className="h-4 w-72" />
      </div>

      {/* Linked section skeleton */}
      <div className="space-y-2">
        <Skeleton className="h-4 w-12" />
        {[1, 2].map((i) => (
          <div
            key={i}
            className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3"
          >
            <div className="space-y-1.5">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-3 w-36" />
            </div>
            <Skeleton className="h-4 w-20" />
          </div>
        ))}
      </div>

      {/* Available section skeleton */}
      <div className="space-y-2">
        <Skeleton className="h-4 w-16" />
        <div className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-3 w-12" />
        </div>
      </div>
    </div>
  );
}
