'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { Task } from '@/server/queries/normalize-task';
import type { ViewTaskPageResult } from '@/server/queries/views';
import type { SavedView } from '@projectflow/types';

interface Props {
  taskPage: ViewTaskPageResult | null;
  activeView: SavedView;
}

const UNASSIGNED = '__unassigned__';

interface Lane { key: string; label: string; tasks: Task[] }

export function BoxView({ taskPage }: Props) {
  const t = useTranslations('Views');
  const tasks = useMemo(() => taskPage?.tasks ?? [], [taskPage]);

  // Group tasks into per-assignee swimlanes (a task with N assignees appears in N
  // lanes — same multi-assignee semantics the engine board uses). Tasks with no
  // assignee fall into a single "Unassigned" lane.
  const lanes: Lane[] = useMemo(() => {
    const byUser = new Map<string, Lane>();
    const ensure = (key: string, label: string) => {
      let lane = byUser.get(key);
      if (!lane) { lane = { key, label, tasks: [] }; byUser.set(key, lane); }
      return lane;
    };
    for (const task of tasks) {
      if (task.assignees.length === 0) {
        ensure(UNASSIGNED, t('box.unassigned')).tasks.push(task);
        continue;
      }
      for (const a of task.assignees) {
        ensure(a.userId, a.name ?? a.email ?? a.userId).tasks.push(task);
      }
    }
    // Stable order: named assignees A→Z, Unassigned last.
    return [...byUser.values()].sort((x, y) => {
      if (x.key === UNASSIGNED) return 1;
      if (y.key === UNASSIGNED) return -1;
      return x.label.localeCompare(y.label);
    });
  }, [tasks, t]);

  if (tasks.length === 0) {
    return (
      <div data-testid="box-empty" className="flex h-full items-center justify-center rounded-lg border border-dashed border-border p-8 text-xs text-muted-foreground">
        {t('noTasks')}
      </div>
    );
  }

  return (
    <div data-testid="view-body-box" className="flex h-full gap-3 overflow-auto rounded-lg border border-border bg-background p-3">
      {lanes.map((lane) => (
        <div
          key={lane.key}
          data-testid={`box-lane-${lane.key}`}
          data-count={lane.tasks.length}
          className="flex w-72 shrink-0 flex-col gap-2 rounded-md bg-muted/30 p-2"
        >
          <div className="flex items-center justify-between px-1 text-xs font-semibold text-foreground">
            <span className="truncate">{lane.label}</span>
            <Badge variant="outline" size="xs" appearance="outline">{lane.tasks.length}</Badge>
          </div>
          <div className="flex flex-col gap-1.5">
            {lane.tasks.map((task) => (
              <div
                key={`${lane.key}:${task.id}`}
                data-testid="box-card"
                className={cn('rounded-md border border-border/60 bg-background p-2 text-xs')}
              >
                <div className="truncate font-medium text-foreground">{task.title || t('untitled')}</div>
                <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                  <Badge variant="outline" size="xs" appearance="outline">{task.status}</Badge>
                  {task.issueKey && <span className="font-mono">{task.issueKey}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
