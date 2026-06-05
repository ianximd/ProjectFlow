'use client';

import { useState, useTransition } from 'react';
import type { TaskType } from '@projectflow/types';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { setTaskType } from '@/server/actions/tasks';
import { notifyActionError } from '@/lib/apiErrorToast';
import { useTranslations } from 'next-intl';

/**
 * Task-type picker for the task drawer. Optimistically commits via setTaskType
 * and rolls back on failure. Milestone types are marked with a diamond glyph.
 */
export function TaskTypeSelector({
  taskId,
  types,
  value,
  disabled,
}: {
  taskId:    string;
  types:     TaskType[];
  value:     string | null;
  disabled?: boolean;
}) {
  const t = useTranslations('Task');
  const [local, setLocal] = useState<string | null>(value);
  const [, start] = useTransition();

  const onChange = (next: string) => {
    const prev = local;
    setLocal(next); // optimistic
    start(async () => {
      const r = await setTaskType(taskId, next);
      if (!r.ok) {
        setLocal(prev); // rollback
        notifyActionError(r);
      }
    });
  };

  return (
    <Select value={local ?? ''} disabled={disabled} onValueChange={onChange}>
      <SelectTrigger aria-label={t('typeSection')}><SelectValue placeholder={t('taskTypePlaceholder')} /></SelectTrigger>
      <SelectContent>
        {types.map((type) => (
          <SelectItem key={type.id} value={type.id}>
            {type.isMilestone ? '◆ ' : ''}{type.nameSingular}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
