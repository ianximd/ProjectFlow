'use client';

import { useTranslations } from 'next-intl';
import { AlertTriangle } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { CapacityResult } from '@projectflow/types';

interface Props {
  /** Per-assignee capacity resolved SSR via getViewCapacity. */
  capacity: CapacityResult | null;
}

/** Format a duration in seconds as a compact "Xh"/"Xh Ym" string. */
function fmtHours(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

const BAR_TONE: Record<string, string> = {
  over:  'bg-red-500',
  at:    'bg-amber-500',
  under: 'bg-emerald-500',
};

export function WorkloadView({ capacity }: Props) {
  const t = useTranslations('Views');
  const rows = capacity?.rows ?? [];
  const isPoints = capacity?.metric === 'points';

  if (rows.length === 0) {
    return (
      <div
        data-testid="workload-empty"
        className="flex h-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border p-8 text-center text-xs text-muted-foreground"
      >
        {t('workload.empty')}
      </div>
    );
  }

  return (
    <div data-testid="view-body-workload" className="flex h-full flex-col gap-2 overflow-auto rounded-lg border border-border bg-background p-3">
      {rows.map((r) => {
        const assigned = isPoints ? r.assignedPoints : r.assignedSeconds;
        const capValue = r.capacity;
        const pct = Math.min(100, Math.round((Number.isFinite(r.ratio) ? r.ratio : 1) * 100));
        const assignedLabel = isPoints ? t('workload.points', { value: assigned }) : fmtHours(assigned);
        const capLabel = isPoints ? t('workload.points', { value: capValue }) : fmtHours(capValue);
        return (
          <div
            key={r.userId}
            data-testid={`workload-row-${r.userId}`}
            data-status={r.status}
            className={cn('rounded-md border border-border/60 p-2', r.status === 'over' && 'border-red-400/60 bg-red-500/5')}
          >
            <div className="mb-1 flex items-center justify-between gap-2 text-xs">
              <span className="font-medium text-foreground">{r.name ?? r.email ?? r.userId}</span>
              <span className="flex items-center gap-2 text-muted-foreground">
                <span className="font-mono">{assignedLabel} / {capLabel}</span>
                {r.status === 'over' && (
                  <Badge
                    data-testid="over-capacity-badge"
                    variant="outline"
                    size="xs"
                    appearance="outline"
                    className="border-red-400/60 text-red-600"
                  >
                    <AlertTriangle className="size-3" aria-hidden="true" /> {t('workload.overCapacity')}
                  </Badge>
                )}
              </span>
            </div>
            <div
              className="h-2 w-full overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-valuenow={pct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={t('workload.barAria', { name: r.name ?? r.userId })}
            >
              <div className={cn('h-full', BAR_TONE[r.status] ?? BAR_TONE.under)} style={{ width: `${pct}%` }} />
            </div>
            <div className="mt-1 text-[11px] text-muted-foreground">{t('workload.taskCount', { count: r.taskCount })}</div>
          </div>
        );
      })}
    </div>
  );
}
