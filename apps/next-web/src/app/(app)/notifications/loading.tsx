import { Skeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <div className="flex h-full flex-col gap-4">
      {/* Header */}
      <Skeleton className="h-9 w-64 rounded-lg" />
      {/* Tab strip */}
      <Skeleton className="h-9 w-48 rounded-lg" />
      {/* Notification rows */}
      <div className="flex flex-col gap-0 overflow-hidden rounded-xl border border-border">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className="h-16 w-full rounded-none border-b border-border last:border-b-0" />
        ))}
      </div>
    </div>
  );
}
