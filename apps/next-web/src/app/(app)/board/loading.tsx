import { Skeleton } from '@/components/ui/skeleton';

export default function BoardLoading() {
  return (
    <div className="flex h-full gap-3 overflow-hidden">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="flex w-[300px] min-w-[300px] flex-col gap-2 rounded-xl border border-border bg-muted/40 p-2"
        >
          <Skeleton className="h-4 w-24" />
          {[0, 1, 2].map((j) => (
            <Skeleton key={j} className="h-20 w-full rounded-lg" />
          ))}
        </div>
      ))}
    </div>
  );
}
