'use client';

import { useState } from 'react';
import { Input, InputAddon, InputGroup } from '@/components/ui/input';
import type { CellProps } from '../CustomFieldCell';

export function CurrencyCell({ field, value, onCommit, disabled }: CellProps<number>) {
  const [v, setV] = useState(value == null ? '' : String(value));
  const currencyCode = field.config?.currencyCode ?? 'USD';
  return (
    <InputGroup>
      <InputAddon>{currencyCode}</InputAddon>
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
    </InputGroup>
  );
}
