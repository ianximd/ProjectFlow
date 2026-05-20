import { Skeleton } from '@/components/ui/skeleton';

export default function WorkflowsLoading() {
  return (
    <div className="flex h-full flex-col gap-4">
      {/* Header placeholder */}
      <div className="flex items-center gap-3">
        <Skeleton className="size-9 rounded-lg" />
        <div className="flex flex-col gap-1.5">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-5 w-40" />
        </div>
      </div>

      {/* Editor: 2-column grid (statuses | transitions) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 flex-1 min-h-0">
        {/* Statuses card */}
        <div className="rounded-xl border border-border overflow-hidden flex flex-col gap-0">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-border/60">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-7 w-24 rounded-md" />
          </div>
          <div className="p-4 flex flex-col gap-4">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="flex flex-col gap-1.5">
                <Skeleton className="h-3.5 w-24" />
                {i % 2 === 0 ? (
                  <>
                    <Skeleton className="h-9 w-full rounded-md" />
                    <Skeleton className="h-9 w-full rounded-md" />
                  </>
                ) : (
                  <Skeleton className="h-9 w-full rounded-md" />
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Transitions card */}
        <div className="rounded-xl border border-border overflow-hidden flex flex-col gap-0">
          <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border/60">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="ml-auto h-3 w-32" />
          </div>
          <div className="p-4 flex flex-col gap-2">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-10 w-full rounded-md" />
            ))}
            {/* Add transition form skeleton */}
            <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-dashed border-border bg-muted/30 p-2">
              <Skeleton className="h-8 w-[160px] rounded-md" />
              <Skeleton className="h-3.5 w-3.5 rounded-full" />
              <Skeleton className="h-8 w-[160px] rounded-md" />
              <Skeleton className="h-8 w-28 rounded-md" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
