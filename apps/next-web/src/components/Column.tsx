'use client';

import { useState, useRef, useEffect } from 'react';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { useDroppable } from '@dnd-kit/core';
import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { TaskCard, type AssigneeRow } from './TaskCard';

// Raw API rows from the backend SPs use PascalCase field names. Components
// read either casing defensively at the field-access site.
type ApiTask = Record<string, any>;

export interface BoardColumn {
  /** Status name — used to filter and to send up the wire on transition. */
  id: string;
  /** Visible header label. Usually identical to id. */
  title: string;
  /** Optional category from the workflow (TODO|IN_PROGRESS|DONE). Drives accent color. */
  category?: string;
}

interface Props {
  column: BoardColumn;
  tasks: ApiTask[];
  /** Pre-bucketed by TaskId (from the list endpoint's meta payload). */
  assigneesByTaskId?: Record<string, AssigneeRow[]>;
  addTask: (columnId: string, content: string) => void;
  deleteTask: (id: string) => void;
  onOpenTask?: (task: ApiTask) => void;
}

// Subtle accent stripe at the top of each column. Keeps the board readable
// at a glance — IDEA amber (early-stage), TODO grey, IN_PROGRESS blue,
// TESTING orange (QA gate), DONE green. Mirrors workflows/page.tsx
// CATEGORY_META so the column accent and the editor chip agree.
const CATEGORY_ACCENT: Record<string, string> = {
  IDEA:        'bg-amber-400 dark:bg-amber-500',
  TODO:        'bg-slate-300 dark:bg-slate-600',
  IN_PROGRESS: 'bg-blue-400 dark:bg-blue-500',
  TESTING:     'bg-orange-400 dark:bg-orange-500',
  DONE:        'bg-emerald-400 dark:bg-emerald-500',
};

export function Column({ column, tasks, assigneesByTaskId, addTask, deleteTask, onOpenTask }: Props) {
  const t = useTranslations('Board');
  const [isAdding,        setIsAdding]        = useState(false);
  const [newTaskContent,  setNewTaskContent]  = useState('');
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (isAdding) inputRef.current?.focus();
  }, [isAdding]);

  const { setNodeRef, isOver } = useDroppable({
    id: column.id,
    data: { type: 'Column', column },
  });

  const sumStoryPoints = tasks.reduce(
    (acc, task) => acc + (Number(task.StoryPoints ?? task.storyPoints) || 0),
    0,
  );
  const sumStoryPointsLabel = sumStoryPoints > 0
    ? Number.isInteger(sumStoryPoints) ? String(sumStoryPoints) : sumStoryPoints.toFixed(1)
    : null;

  const accent = CATEGORY_ACCENT[column.category ?? 'TODO'] ?? CATEGORY_ACCENT.TODO!;

  const submit = () => {
    const v = newTaskContent.trim();
    if (!v) return;
    addTask(column.id, v);
    setNewTaskContent('');
    setIsAdding(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
    else if (e.key === 'Escape')           { setIsAdding(false); setNewTaskContent(''); }
  };

  const taskIds = tasks.map((task) => String(task.Id ?? task.id ?? ''));

  return (
    <div
      role="listitem"
      className={cn(
        'flex w-[300px] min-w-[300px] max-w-[300px] flex-col rounded-xl border border-border bg-muted/40',
        'transition-colors',
        isOver && 'bg-primary/5 ring-2 ring-primary/30',
      )}
    >
      {/* Accent stripe */}
      <div className={cn('h-1 rounded-t-xl', accent)} aria-hidden="true" />

      {/* Header */}
      <div className="flex items-center gap-2 px-3 pt-2.5 pb-2">
        <h2
          id={`col-${column.id}`}
          className="text-xs font-semibold uppercase tracking-wide text-muted-foreground truncate"
        >
          {column.title}
        </h2>
        <span
          className="rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground"
          aria-label={t('columnIssueCount', { count: tasks.length })}
        >
          {tasks.length}
        </span>
        {sumStoryPointsLabel && (
          <span
            className="ml-auto rounded-md bg-background px-1.5 py-0.5 font-mono text-[10px] font-medium text-muted-foreground border border-border"
            title={t('columnStoryPoints', { points: sumStoryPointsLabel })}
            aria-label={t('columnStoryPoints', { points: sumStoryPointsLabel })}
          >
            {sumStoryPointsLabel} pt
          </span>
        )}
      </div>

      {/* Card list (scrollable) */}
      <div
        ref={setNodeRef}
        role="list"
        aria-labelledby={`col-${column.id}`}
        className="flex flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2 min-h-[80px] scrollbar-thin"
      >
        <SortableContext items={taskIds} strategy={verticalListSortingStrategy}>
          {tasks.map((task) => {
            const id = String(task.Id ?? task.id);
            return (
              <TaskCard
                key={id}
                task={task}
                assignees={assigneesByTaskId?.[id]}
                deleteTask={deleteTask}
                onOpen={onOpenTask}
              />
            );
          })}
        </SortableContext>

        {tasks.length === 0 && !isAdding && (
          <div className="flex flex-1 items-center justify-center rounded-md border border-dashed border-border/60 px-2 py-6 text-center text-xs text-muted-foreground/70">
            {t('columnDropEmpty')}
          </div>
        )}
      </div>

      {/* Inline add form / trigger */}
      <div className="px-2 pb-2">
        {isAdding ? (
          <div className="flex flex-col gap-2 rounded-md border border-primary/40 bg-card p-2 shadow-sm">
            <label htmlFor={`new-task-${column.id}`} className="sr-only">
              {t('columnNewIssueLabelFor', { column: column.title })}
            </label>
            <textarea
              ref={inputRef}
              id={`new-task-${column.id}`}
              value={newTaskContent}
              onChange={(e) => setNewTaskContent(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t('columnNewIssuePlaceholder')}
              rows={2}
              className="w-full resize-none rounded-sm bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              aria-label={t('columnNewIssueLabelFor', { column: column.title })}
            />
            <div className="flex items-center gap-2">
              <Button size="sm" variant="primary" onClick={submit} disabled={!newTaskContent.trim()}>
                {t('columnAddAriaLabel')}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => { setIsAdding(false); setNewTaskContent(''); }}
              >
                {t('columnCancelAdd')}
              </Button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setIsAdding(true)}
            className={cn(
              'flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-medium text-muted-foreground',
              'transition-colors hover:bg-muted hover:text-foreground',
            )}
            aria-label={t('columnCreateAriaLabel', { column: column.title })}
          >
            <Plus className="size-4" />
            {t('columnCreateLabel')}
          </button>
        )}
      </div>
    </div>
  );
}
