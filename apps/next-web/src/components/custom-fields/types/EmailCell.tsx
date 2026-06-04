'use client';

import { useState } from 'react';
import { Input } from '@/components/ui/input';
import type { CellProps } from '../CustomFieldCell';

export function EmailCell({ field, value, onCommit, disabled }: CellProps<string>) {
  const [v, setV] = useState(value ?? '');
  return (
    <Input
      type="email"
      aria-label={field.name}
      disabled={disabled}
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => { if ((v ?? '') !== (value ?? '')) onCommit(v === '' ? null : v); }}
    />
  );
}
