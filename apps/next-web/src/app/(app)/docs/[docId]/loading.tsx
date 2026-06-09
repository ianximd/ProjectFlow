import { Skeleton } from '@/components/ui/skeleton';

export default function DocLoading() {
  return (
    <div className="flex h-full gap-3 overflow-hidden">
      <div className="flex w-[220px] min-w-[220px] flex-col gap-2 rounded-xl border border-border bg-muted/40 p-2">
        <Skeleton className="h-4 w-24" />
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-6 w-full rounded-md" />
        ))}
      </div>
      <div className="flex flex-1 flex-col gap-2 p-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-5/6" />
      </div>
      <div className="flex w-[200px] min-w-[200px] flex-col gap-2 rounded-xl border border-border bg-muted/40 p-2">
        <Skeleton className="h-4 w-20" />
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-10 w-full rounded-md" />
        ))}
      </div>
    </div>
  );
}
