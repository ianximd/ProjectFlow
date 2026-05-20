import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

export default function BacklogLoading() {
  return (
    <div className="flex h-full flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Skeleton className="size-9 rounded-lg" />
          <div className="flex flex-col gap-1.5">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-5 w-40" />
          </div>
        </div>
        <Skeleton className="h-8 w-[180px] rounded-md" />
      </div>

      {/* Filter bar */}
      <Skeleton className="h-10 w-full rounded-lg" />

      {/* Sections */}
      <div className="flex flex-col gap-3">
        {[0, 1, 2].map((i) => (
          <Card key={i} className="p-4 flex flex-col gap-2">
            <Skeleton className="h-5 w-40" />
            {[0, 1].map((j) => <Skeleton key={j} className="h-7 w-full" />)}
          </Card>
        ))}
      </div>
    </div>
  );
}
