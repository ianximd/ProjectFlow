import { Skeleton } from '@/components/ui/skeleton';

export default function WorkspaceSettingsLoading() {
  return (
    <div className="flex h-full flex-col gap-4 max-w-3xl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Skeleton className="size-4 rounded" />
        <Skeleton className="size-9 rounded-lg" />
        <div className="flex flex-col gap-1.5">
          <Skeleton className="h-3 w-32" />
          <Skeleton className="h-5 w-40" />
        </div>
      </div>

      {/* General card */}
      <Skeleton className="h-64 rounded-xl" />

      {/* Danger zone card */}
      <Skeleton className="h-48 rounded-xl" />
    </div>
  );
}
