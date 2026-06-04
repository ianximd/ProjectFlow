'use client';

import { Input } from '@/components/ui/input';
import type { CellProps } from '../CustomFieldCell';

/** Format a stored ISO string into the value a date / datetime-local input expects. */
function toInputValue(iso: string | null | undefined, includeTime: boolean): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  // Slice the ISO string: YYYY-MM-DD for date, YYYY-MM-DDTHH:mm for datetime-local.
  return includeTime ? d.toISOString().slice(0, 16) : d.toISOString().slice(0, 10);
}

export function DateCell({ field, value, onCommit, disabled }: CellProps<string>) {
  const includeTime = !!field.config?.includeTime;
  return (
    <Input
      type={includeTime ? 'datetime-local' : 'date'}
      aria-label={field.name}
      disabled={disabled}
      value={toInputValue(value, includeTime)}
      onChange={(e) => onCommit(e.target.value ? new Date(e.target.value).toISOString() : null)}
    />
  );
}
