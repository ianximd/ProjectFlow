'use client';

import { useEffect, useMemo, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { formatShortDate } from '@/lib/date';
import { useLiveTasks } from '@/lib/realtime/useLiveTasks';
import { taskFieldValue } from './field-options';
import type { ViewTaskPageResult } from '@/server/queries/views';
import type { Task } from '@/server/queries/normalize-task';
import type { CustomField, SavedView } from '@projectflow/types';

interface Props {
  /** Paged tasks for the active view. Null when no view is active (handled upstream). */
  taskPage: ViewTaskPageResult | null;
  /** The active saved view — config.groupBy drives grouping. */
  activeView: SavedView;
  /** The scope's custom fields (kept for parity with TableView / future cells). */
  customFields: CustomField[];
  /** Bulk-bar wiring (E6): fires with the selected task ids whenever selection changes. */
  onSelectionChange?: (ids: string[]) => void;
}

interface RowGroup {
  key: string | null;
  label: string | null;
  count: number | null;
  tasks: Task[];
}

const PRIORITY_DOT: Record<string, string> = {
  HIGHEST: 'bg-red-500',
  HIGH: 'bg-orange-500',
  MEDIUM: 'bg-amber-500',
  LOW: 'bg-sky-500',
  LOWEST: 'bg-slate-400',
};

export function ListView({ taskPage, activeView, customFields, onSelectionChange }: Props) {
  const baseTasks = useMemo(() => taskPage?.tasks ?? [], [taskPage]);
  // Live `taskUpdated` deltas merged onto the SSR page. The subscription's
  // projectId arg is a required truthy placeholder only — `task:updated` is a
  // GLOBAL channel and scoping is done client-side by mergeTaskDelta's id-match
  // against these visible tasks; `activeView.id` is a stable truthy key (and the
  // same value Apollo can dedupe across the other view surfaces).
  const tasks = useLiveTasks(activeView.id, baseTasks);
  const groups = useMemo(() => taskPage?.groups ?? [], [taskPage]);
  const config = activeView.config;

  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Effective selection = stored selection ∩ currently-visible tasks. Derived
  // during render (not via a setState effect) so ids left over from a prior page
  // never leak through onSelectionChange, and we avoid an extra render pass.
  const liveSelected = useMemo(() => {
    const live = new Set(tasks.map((t) => t.id));
    return [...selected].filter((id) => live.has(id));
  }, [tasks, selected]);

  useEffect(() => {
    onSelectionChange?.(liveSelected);
  }, [liveSelected, onSelectionChange]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const rowGroups: RowGroup[] = useMemo(() => {
    if (!config.groupBy) return [{ key: null, label: null, count: null, tasks }];
    const groupBy = config.groupBy;
    const buckets = new Map<string, Task[]>();
    for (const t of tasks) {
      const v = taskFieldValue(t, groupBy, customFields);
      const k = v == null || v === '' ? '∅' : String(v);
      const arr = buckets.get(k) ?? [];
      arr.push(t);
      buckets.set(k, arr);
    }
    return [...buckets.entries()].map(([key, groupTasks]) => {
      const meta = groups.find((g) => g.key === key);
      return {
        key,
        label: meta?.label ?? (key === '∅' ? '(empty)' : key),
        count: meta?.count ?? groupTasks.length,
        tasks: groupTasks,
      };
    });
  }, [tasks, groups, config.groupBy, customFields]);

  return (
    <div
      data-testid="view-body-list"
      className="flex h-full flex-col overflow-auto rounded-lg border border-border bg-background"
    >
      {tasks.length === 0 ? (
        <div className="px-3 py-6 text-center text-xs text-muted-foreground">No tasks.</div>
      ) : (
        rowGroups.map((g) => (
          <div key={g.key ?? '__flat__'}>
            {g.key !== null && (
              <div
                data-testid="list-group-header"
                className="border-b border-border bg-muted/20 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
              >
                {g.label} {g.count != null && <span className="font-normal">({g.count})</span>}
              </div>
            )}
            {g.tasks.map((t) => (
              <TaskRow
                key={t.id}
                task={t}
                selected={selected.has(t.id)}
                onToggle={() => toggle(t.id)}
              />
            ))}
          </div>
        ))
      )}
    </div>
  );
}

// Flat task row reused for the List view. Mirrors TaskCard's type/priority/dueDate
// presentation (Badge + priority dot + date) in a single-line layout.
function TaskRow({
  task,
  selected,
  onToggle,
}: {
  task: Task;
  selected: boolean;
  onToggle: () => void;
}) {
  const dot = PRIORITY_DOT[(task.priority ?? '').toUpperCase()] ?? PRIORITY_DOT.MEDIUM;
  const due = task.dueDate ? formatShortDate(new Date(task.dueDate)) : null;

  return (
    <div
      data-testid="list-row"
      data-selected={selected ? 'true' : undefined}
      className={cn(
        'flex items-center gap-3 border-b border-border/60 px-3 py-2 text-xs hover:bg-muted/30',
        selected && 'bg-primary/5',
      )}
    >
      <Checkbox
        size="sm"
        checked={selected}
        onCheckedChange={onToggle}
        aria-label={`Select ${task.title}`}
        data-testid="row-select"
      />
      <span
        className={cn('inline-block size-2 shrink-0 rounded-full', dot)}
        aria-label={`Priority: ${task.priority}`}
        title={`Priority: ${task.priority}`}
      />
      <span className="min-w-0 flex-1 truncate font-medium text-foreground">
        {task.title || <span className="italic text-muted-foreground">(untitled)</span>}
      </span>
      {task.issueKey && (
        <span className="shrink-0 font-mono text-[11px] text-muted-foreground/80">{task.issueKey}</span>
      )}
      <Badge variant="outline" size="xs" appearance="outline" className="shrink-0">
        {task.status}
      </Badge>
      {due && <span className="shrink-0 text-muted-foreground">{due}</span>}
      {task.storyPoints != null && (
        <Badge variant="outline" size="xs" appearance="outline" className="shrink-0 font-mono">
          {task.storyPoints}
        </Badge>
      )}
    </div>
  );
}
