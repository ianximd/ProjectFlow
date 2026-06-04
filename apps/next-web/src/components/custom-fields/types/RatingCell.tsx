'use client';

import { Star } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { CellProps } from '../CustomFieldCell';

export function RatingCell({ field, value, onCommit, disabled }: CellProps<number>) {
  const max = field.config?.max ?? 5;
  const current = value ?? 0;
  return (
    <div className="flex items-center gap-0.5" role="group" aria-label={field.name}>
      {Array.from({ length: max }, (_, i) => i + 1).map((k) => (
        <button
          key={k}
          type="button"
          disabled={disabled}
          aria-label={`${field.name}: ${k}`}
          aria-pressed={k <= current}
          className="text-muted-foreground/50 hover:text-yellow-500 disabled:cursor-not-allowed disabled:opacity-60"
          // Click the current rating to clear it (commit 0); otherwise set k.
          onClick={() => onCommit(k === current ? 0 : k)}
        >
          <Star className={cn('size-4', k <= current && 'fill-yellow-400 text-yellow-400')} />
        </button>
      ))}
    </div>
  );
}
