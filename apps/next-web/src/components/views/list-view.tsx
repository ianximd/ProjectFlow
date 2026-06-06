'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';

import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { formatShortDate } from '@/lib/date';
import { useLiveTasks, buildAccepts } from '@/lib/realtime/useLiveTasks';
import type { LiveScopeProp } from '@/components/views/view-surface';
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
  /** Live-subscription scope (created/updated/deleted), resolved SSR in the page. */
  live: LiveScopeProp;
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

// Raw priority enum → Board namespace label key (reuse the Board catalog rather
// than rendering the raw "HIGHEST"/"MEDIUM" enum in the aria-label/title).
const PRIORITY_LABEL_KEY: Record<string, string> = {
  HIGHEST: 'priorityHighest',
  HIGH: 'priorityHigh',
  MEDIUM: 'priorityMedium',
  LOW: 'priorityLow',
  LOWEST: 'priorityLowest',
};

export function ListView({ taskPage, activeView, customFields, onSelectionChange, live }: Props) {
  const t = useTranslations('Views');
  const baseTasks = useMemo(() => taskPage?.tasks ?? [], [taskPage]);
  // Live task events (created/updated/deleted) merged onto the SSR page. Keyed by
  // the resolved owning project (SPACE/LIST/FOLDER) or workspace (EVERYTHING);
  // `buildAccepts` gates which live `created` tasks belong in this surface.
  const tasks = useLiveTasks(
    baseTasks,
    live.projectId ? { projectId: live.projectId } : { workspaceId: live.workspaceId },
    buildAccepts(live.acceptKind, live.listScopeId),
  );
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
        label: meta?.label ?? (key === '∅' ? t('groupEmpty') : key),
        count: meta?.count ?? groupTasks.length,
        tasks: groupTasks,
      };
    });
  }, [tasks, groups, config.groupBy, customFields, t]);

  return (
    <div
      data-testid="view-body-list"
      className="flex h-full flex-col overflow-auto rounded-lg border border-border bg-background"
    >
      {tasks.length === 0 ? (
        <div className="px-3 py-6 text-center text-xs text-muted-foreground">{t('noTasks')}</div>
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
  const t = useTranslations('Views');
  const tBoard = useTranslations('Board');
  const upperPriority = (task.priority ?? '').toUpperCase();
  const dot = PRIORITY_DOT[upperPriority] ?? PRIORITY_DOT.MEDIUM;
  // Translated priority label (falls back to the raw value for unknown enums).
  const priorityLabelKey = PRIORITY_LABEL_KEY[upperPriority];
  const priorityLabel = priorityLabelKey
    ? tBoard(priorityLabelKey as 'priorityHighest')
    : (task.priority ?? '');
  const priorityAria = tBoard('taskPriorityAriaLabel', { priority: priorityLabel });
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
        aria-label={t('selectRow', { title: task.title || t('untitled') })}
        data-testid="row-select"
      />
      <span
        className={cn('inline-block size-2 shrink-0 rounded-full', dot)}
        aria-label={priorityAria}
        title={priorityAria}
      />
      <span className="min-w-0 flex-1 truncate font-medium text-foreground">
        {task.title || <span className="italic text-muted-foreground">{t('untitled')}</span>}
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
