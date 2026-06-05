'use client';

import { useTranslations } from 'next-intl';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import type { CellProps } from '../CustomFieldCell';

export function LabelsCell({ field, value, onCommit, disabled }: CellProps<string[]>) {
  const t = useTranslations('CustomFields');
  const options = field.config?.options ?? [];
  const selected = value ?? [];

  function toggle(id: string) {
    const next = selected.includes(id)
      ? selected.filter((x) => x !== id)
      : [...selected, id];
    onCommit(next);
  }

  const summary = selected.length === 0
    ? '—'
    : options.filter((o) => selected.includes(o.id)).map((o) => o.name).join(', ');

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" disabled={disabled} aria-label={field.name} className="w-full justify-start font-normal">
          {summary}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-2">
        <div className="flex flex-col gap-1">
          {options.length === 0 && <span className="px-2 py-1 text-xs text-muted-foreground">{t('noOptions')}</span>}
          {options.map((o) => (
            <label key={o.id} className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-accent cursor-pointer">
              <Checkbox checked={selected.includes(o.id)} onCheckedChange={() => toggle(o.id)} />
              <span className="text-sm">{o.name}</span>
            </label>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
