'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import type { CellProps } from '../CustomFieldCell';

// There is no ui/textarea primitive; use a plain styled <textarea> mirroring
// the Input field's surface tokens.
const textAreaClass = cn(
  'flex w-full min-h-[4rem] rounded-md bg-background border border-input shadow-xs shadow-black/5',
  'px-3 py-2 text-[0.8125rem] text-foreground placeholder:text-muted-foreground/80',
  'transition-[color,box-shadow] focus-visible:ring-ring/30 focus-visible:border-ring',
  'focus-visible:outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-60',
);

export function TextAreaCell({ field, value, onCommit, disabled }: CellProps<string>) {
  const [v, setV] = useState(value ?? '');
  return (
    <textarea
      aria-label={field.name}
      className={textAreaClass}
      disabled={disabled}
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => { if ((v ?? '') !== (value ?? '')) onCommit(v === '' ? null : v); }}
    />
  );
}
