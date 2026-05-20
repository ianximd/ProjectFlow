import { Skeleton } from '@/components/ui/skeleton';

export default function WorkspacesLoading() {
  return (
    <div className="flex h-full flex-col gap-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Skeleton className="size-9 rounded-lg" />
        <div className="flex flex-1 flex-col gap-1.5">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-5 w-32" />
        </div>
        <Skeleton className="h-8 w-32 rounded-md" />
      </div>

      {/* Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {[0, 1, 2].map((i) => <Skeleton key={i} className="h-32 rounded-xl" />)}
      </div>
    </div>
  );
}
