'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { loadWorkspaceMembers } from '@/server/actions/members';
import type { MemberRow } from '@/server/queries/workspace';
import type { CellProps } from '../CustomFieldCell';

export function PeopleCell({ field, value, onCommit, disabled }: CellProps<string[]>) {
  const t = useTranslations('CustomFields');
  // The field's workspace is the task's workspace; reuse the assignee picker's
  // member source and lazy-load it only when the popover opens (TaskDrawer pattern).
  const [members, setMembers] = useState<MemberRow[] | null>(null);
  const [loading, start] = useTransition();
  const selected = value ?? [];

  function ensureMembers(open: boolean) {
    if (!open || members) return;
    start(async () => {
      try {
        setMembers(await loadWorkspaceMembers(field.workspaceId));
      } catch {
        setMembers([]);
      }
    });
  }

  function toggle(id: string) {
    const next = selected.includes(id)
      ? selected.filter((x) => x !== id)
      : [...selected, id];
    onCommit(next); // server re-validates membership
  }

  const summary = selected.length === 0
    ? '—'
    : (members
        ? members.filter((m) => selected.includes(m.id)).map((m) => m.name ?? m.email).join(', ')
        : t('selectedCount', { count: selected.length }));

  return (
    <Popover onOpenChange={ensureMembers}>
      <PopoverTrigger asChild>
        <Button variant="outline" disabled={disabled} aria-label={field.name} className="w-full justify-start font-normal">
          {summary}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-2">
        <div className="flex flex-col gap-1">
          {loading && <span className="px-2 py-1 text-xs text-muted-foreground">{t('loadingMembers')}</span>}
          {members && members.length === 0 && (
            <span className="px-2 py-1 text-xs text-muted-foreground">{t('noMembers')}</span>
          )}
          {members?.map((m) => (
            <label key={m.id} className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-accent cursor-pointer">
              <Checkbox checked={selected.includes(m.id)} onCheckedChange={() => toggle(m.id)} />
              <span className="text-sm">{m.name ?? m.email}</span>
            </label>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
