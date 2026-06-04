'use client';

import { useState } from 'react';
import { Input } from '@/components/ui/input';
import type { CellProps } from '../CustomFieldCell';

export function NumberCell({ field, value, onCommit, disabled }: CellProps<number>) {
  const [v, setV] = useState(value == null ? '' : String(value));
  return (
    <Input
      type="number"
      aria-label={field.name}
      disabled={disabled}
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => {
        const next = v === '' ? null : Number(v);
        if (next !== (value ?? null)) onCommit(next);
      }}
    />
  );
}
