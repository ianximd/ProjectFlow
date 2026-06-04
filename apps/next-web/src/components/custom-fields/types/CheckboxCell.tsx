'use client';

import { Checkbox } from '@/components/ui/checkbox';
import type { CellProps } from '../CustomFieldCell';

export function CheckboxCell({ field, value, onCommit, disabled }: CellProps<boolean>) {
  return (
    <Checkbox
      aria-label={field.name}
      disabled={disabled}
      checked={!!value}
      onCheckedChange={(checked) => onCommit(!!checked)}
    />
  );
}
