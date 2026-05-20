import { Skeleton } from '@/components/ui/skeleton';

export default function AdminLoading() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* Header */}
      <div>
        <Skeleton className="h-7 w-40 mb-2" />
        <Skeleton className="h-4 w-64" />
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        {[120, 80, 130, 100, 170].map((w, i) => (
          <Skeleton key={i} className="h-9 rounded-md" style={{ width: w }} />
        ))}
      </div>

      {/* Stat cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '1rem' }}>
        {[0, 1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} style={{ padding: '1rem', borderRadius: '0.5rem', border: '1px solid #e2e8f0' }}>
            <Skeleton className="h-8 w-16 mb-2" />
            <Skeleton className="h-4 w-24" />
          </div>
        ))}
      </div>

      {/* Table skeleton */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        <Skeleton className="h-10 w-full rounded-md" />
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-12 w-full rounded-md" />
        ))}
      </div>
    </div>
  );
}
