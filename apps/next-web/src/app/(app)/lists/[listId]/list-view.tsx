'use client';

import { useState, useTransition } from 'react';
import { createTaskInList } from '@/server/actions/hierarchy';
import { HIERARCHY_ICONS } from '@/config/hierarchy.config';

const ListIcon = HIERARCHY_ICONS.list;

/** Minimal List view: shows the list's tasks (via everythingUnder) and an
 *  inline create input that re-homes new tasks into this List. Reuses the
 *  task title rendering pattern; full drawer wiring lands with the board. */
export function ListView({
  listId,
  workspaceId,
  tasks,
}: {
  listId: string;
  workspaceId: string;
  tasks: any[];
}) {
  const [, startTransition] = useTransition();
  const [title, setTitle] = useState('');

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
        <span>List</span>
      </div>

      <input
        data-testid="list-task-input"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') add(); }}
        placeholder="Add a task and press Enter…"
        className="w-full max-w-xl h-9 rounded border border-input bg-background px-3 text-sm outline-none focus:border-primary"
      />

      <ul className="space-y-1 max-w-xl">
        {tasks.map((t: any) => (
          <li
            key={t.Id ?? t.id}
            data-testid="list-task"
            className="flex items-center gap-2 h-9 px-3 rounded border border-border text-sm"
          >
            <span className="text-xs text-muted-foreground">{t.IssueKey ?? t.issueKey ?? ''}</span>
            <span className="grow truncate">{t.Title ?? t.title}</span>
          </li>
        ))}
        {tasks.length === 0 && (
          <li className="text-sm text-muted-foreground px-3 py-2">No tasks yet.</li>
        )}
      </ul>
    </div>
  );
}
