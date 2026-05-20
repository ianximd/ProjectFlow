import { Skeleton } from '@/components/ui/skeleton';
import { Card } from '@/components/ui/card';

export default function Loading() {
  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex items-center gap-3">
        <Skeleton className="size-4" />
        <Skeleton className="size-9 rounded-lg" />
        <div className="flex flex-col gap-1 flex-1">
          <Skeleton className="h-3 w-32" />
          <Skeleton className="h-4 w-24" />
        </div>
        <Skeleton className="h-8 w-20" />
      </div>
      <Card className="p-4 flex flex-col gap-2">
        {[0, 1, 2].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
      </Card>
    </div>
  );
}
