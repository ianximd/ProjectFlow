'use client';

import { useMemo, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { createTaskInList } from '@/server/actions/hierarchy';
import { useLiveTasks } from '@/lib/realtime/useLiveTasks';
import { normalizeTask } from '@/server/queries/normalize-task';
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

  // SSR rows are PascalCase REST shapes; normalize to the stable camelCase `Task`
  // so the live hook's `accepts`/merge (which operate on normalized tasks) line up.
  const baseTasks = useMemo(() => (tasks ?? []).map(normalizeTask), [tasks]);

  // Live task events (created/updated/deleted) for this list. Project-scoped
  // subscription (`projectId` = the owning Space); the `accepts` gate keeps only
  // created tasks that belong to THIS list. `projectId` may be null when no
  // project context — the hook then skips the subscription and just shows SSR.
  const rows = useLiveTasks(baseTasks, { projectId }, (t) => t.listId === listId);

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
        {rows.map((task) => (
          <li
            key={task.id}
            data-testid="list-task"
            className="flex items-center gap-2 h-9 px-3 rounded border border-border text-sm"
          >
            <span className="text-xs text-muted-foreground">{task.issueKey ?? ''}</span>
            <span className="grow truncate">{task.title}</span>
          </li>
        ))}
        {rows.length === 0 && (
          <li className="text-sm text-muted-foreground px-3 py-2">{t('noTasks')}</li>
        )}
      </ul>
    </div>
  );
}
