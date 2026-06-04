'use client';

import type { CellProps } from '../CustomFieldCell';

/** Read-only: the percentage is computed server-side (e.g. from subtasks). No commit. */
export function ProgressAutoCell({ field, value }: CellProps<number>) {
  const pct = Math.min(100, Math.max(0, value ?? 0));
  return (
    <div className="flex items-center gap-2" role="progressbar" aria-label={field.name} aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-1.5 flex-1 rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
      </div>
      <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">{pct}%</span>
    </div>
  );
}
