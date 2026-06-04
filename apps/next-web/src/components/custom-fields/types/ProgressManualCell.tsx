'use client';

import { useState } from 'react';
import { Input } from '@/components/ui/input';
import type { CellProps } from '../CustomFieldCell';

function clamp(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.min(100, Math.max(0, n));
}

export function ProgressManualCell({ field, value, onCommit, disabled }: CellProps<number>) {
  const [v, setV] = useState(value == null ? '' : String(value));
  const pct = clamp(value ?? 0);
  return (
    <div className="flex items-center gap-2">
      <Input
        type="number"
        min={0}
        max={100}
        aria-label={field.name}
        disabled={disabled}
        value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => {
          const next = v === '' ? null : clamp(Number(v));
          if (next !== (value ?? null)) onCommit(next);
        }}
        className="w-20"
      />
      <div className="h-1.5 flex-1 rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
