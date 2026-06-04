'use client';

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { CellProps } from '../CustomFieldCell';

export function DropdownCell({ field, value, onCommit, disabled }: CellProps<string>) {
  const options = field.config?.options ?? [];
  return (
    <Select value={value ?? ''} disabled={disabled} onValueChange={(v) => onCommit(v || null)}>
      <SelectTrigger aria-label={field.name}><SelectValue placeholder="—" /></SelectTrigger>
      <SelectContent>
        {options.map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}
