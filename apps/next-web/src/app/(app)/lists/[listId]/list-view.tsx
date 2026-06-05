'use client';

import { useEffect, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { useSubscription } from '@apollo/client/react';
import { createTaskInList } from '@/server/actions/hierarchy';
import { TASK_UPDATED } from '@/lib/realtime/operations';
import type { TaskDelta } from '@/lib/realtime/merge-task-delta';
import { HIERARCHY_ICONS } from '@/config/hierarchy.config';

const ListIcon = HIERARCHY_ICONS.list;

/** Minimal List view: shows the list's tasks (via everythingUnder) and an
 *  inline create input that re-homes new tasks into this List. Reuses the
 *  task title rendering pattern; full drawer wiring lands with the board. */
export function ListView({
  listId,
  workspaceId,
  projectId,
  tasks,
}: {
  listId: string;
  workspaceId: string;
  projectId: string | null;
  tasks: any[];
}) {
  const t = useTranslations('Lists');
  const [, startTransition] = useTransition();
  const [title, setTitle] = useState('');

  // Live task updates: SSR rows stay the base; a `taskUpdated` delta patches the
  // matching row's title/key in place. Rows are PascalCase REST shapes, so write
  // both casings. Update-only (no live add/remove) — re-seeds from SSR on nav.
  const [rows, setRows] = useState<any[]>(tasks);
  useEffect(() => { setRows(tasks); }, [tasks]);

  useSubscription<{ taskUpdated: TaskDelta }>(TASK_UPDATED, {
    variables: { projectId: projectId ?? '' },
    skip: !projectId,
    onData: ({ data }) => {
      const d = data.data?.taskUpdated;
      if (!d) return;
      setRows((prev) => prev.map((r) =>
        (r.Id ?? r.id) === d.id
          ? {
              ...r,
              ...(d.title    != null ? { Title: d.title, title: d.title } : {}),
              ...(d.issueKey != null ? { IssueKey: d.issueKey, issueKey: d.issueKey } : {}),
            }
          : r,
      ));
    },
  });

  function add() {
    const t = title.trim();
    if (!t) return;
    setTitle('');
    startTransition(async () => {
      const res = await createTaskInList(listId, workspaceId, t);
      if (!res.ok) console.error('create task failed:', res.error);
    });
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center gap-2 text-lg font-semibold">
        <ListIcon className="size-5 text-muted-foreground" />
        <span>{t('heading')}</span>
      </div>

      <input
        data-testid="list-task-input"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') add(); }}
        placeholder={t('addTaskPlaceholder')}
        className="w-full max-w-xl h-9 rounded border border-input bg-background px-3 text-sm outline-none focus:border-primary"
      />

      <ul className="space-y-1 max-w-xl">
        {rows.map((task: any) => (
          <li
            key={task.Id ?? task.id}
            data-testid="list-task"
            className="flex items-center gap-2 h-9 px-3 rounded border border-border text-sm"
          >
            <span className="text-xs text-muted-foreground">{task.IssueKey ?? task.issueKey ?? ''}</span>
            <span className="grow truncate">{task.Title ?? task.title}</span>
          </li>
        ))}
        {rows.length === 0 && (
          <li className="text-sm text-muted-foreground px-3 py-2">{t('noTasks')}</li>
        )}
      </ul>
    </div>
  );
}
