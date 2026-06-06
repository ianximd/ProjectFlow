'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';

import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { useLiveTasks } from '@/lib/realtime/useLiveTasks';
import { fieldRefLabel, taskFieldValue } from './field-options';
import type { ViewTaskPageResult } from '@/server/queries/views';
import type { Task } from '@/server/queries/normalize-task';
import type { CustomField, FieldRef, SavedView } from '@projectflow/types';

interface Props {
  /** Paged tasks for the active view. Null when no view is active (handled upstream). */
  taskPage: ViewTaskPageResult | null;
  /** The active saved view — config.columns / config.groupBy drive the layout. */
  activeView: SavedView;
  /** The scope's custom fields, used to label/render custom columns. */
  customFields: CustomField[];
  /** Bulk-bar wiring (E6): fires with the selected task ids whenever selection changes. */
  onSelectionChange?: (ids: string[]) => void;
}

// Default columns when a view has none configured. Mirrors the columns a typical
// task list shows. These are all built-in FieldRefs.
const DEFAULT_COLUMNS: FieldRef[] = [
  { kind: 'builtin', key: 'title' },
  { kind: 'builtin', key: 'status' },
  { kind: 'builtin', key: 'priority' },
  { kind: 'builtin', key: 'dueDate' },
];

/** A grouped or flat slice of rows ready to render. `key`/`label`/`count` are
 *  null for the flat (ungrouped) case. */
interface RowGroup {
  key: string | null;
  label: string | null;
  count: number | null;
  tasks: Task[];
}

export function TableView({ taskPage, activeView, customFields, onSelectionChange }: Props) {
  const t = useTranslations('Views');
  const baseTasks = useMemo(() => taskPage?.tasks ?? [], [taskPage]);
  // Live `taskUpdated` deltas merged onto the SSR page. The subscription's
  // projectId arg is a required truthy placeholder only — `task:updated` is a
  // GLOBAL channel and scoping is done client-side by mergeTaskDelta's id-match
  // against these visible tasks; `activeView.id` is a stable truthy key (and the
  // same value Apollo can dedupe across the other view surfaces).
  const tasks = useLiveTasks(activeView.id, baseTasks);
  const groups = useMemo(() => taskPage?.groups ?? [], [taskPage]);
  const config = activeView.config;

  const columns: FieldRef[] =
    config.columns && config.columns.length > 0 ? config.columns : DEFAULT_COLUMNS;

  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Effective selection = stored selection ∩ currently-visible tasks. Derived
  // during render (not via a setState effect) so ids for tasks that left the page
  // (e.g. after a refresh) never leak through onSelectionChange.
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

  const allSelected = tasks.length > 0 && tasks.every((t) => selected.has(t.id));
  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(tasks.map((t) => t.id)));

  // Client-side grouping: when config.groupBy is set, bucket rows by the field's
  // value and align each bucket to a `taskPage.groups` entry for the count/label.
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

  const colCount = columns.length + 1; // + selection column

  return (
    <div
      data-testid="view-body-table"
      className="flex h-full flex-col overflow-auto rounded-lg border border-border bg-background"
    >
      <table className="w-full border-collapse text-xs">
        <thead className="sticky top-0 z-10 bg-muted/40">
          <tr className="border-b border-border text-left text-muted-foreground">
            <th className="w-9 px-2 py-2">
              <Checkbox
                size="sm"
                checked={allSelected}
                onCheckedChange={toggleAll}
                aria-label={t('selectAllRows')}
                data-testid="row-select-all"
              />
            </th>
            {columns.map((c) => (
              <th key={fieldKey(c)} className="px-3 py-2 font-medium">
                {fieldRefLabel(c, customFields)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {tasks.length === 0 ? (
            <tr>
              <td colSpan={colCount} className="px-3 py-6 text-center text-muted-foreground">
                {t('noTasks')}
              </td>
            </tr>
          ) : (
            rowGroups.map((g) => (
              <GroupBlock
                key={g.key ?? '__flat__'}
                group={g}
                columns={columns}
                colCount={colCount}
                customFields={customFields}
                selected={selected}
                onToggle={toggle}
                selectRowLabel={(title) => t('selectRow', { title })}
              />
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function GroupBlock({
  group,
  columns,
  colCount,
  customFields,
  selected,
  onToggle,
  selectRowLabel,
}: {
  group: RowGroup;
  columns: FieldRef[];
  colCount: number;
  customFields: CustomField[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  selectRowLabel: (title: string) => string;
}) {
  return (
    <>
      {group.key !== null && (
        <tr className="bg-muted/20" data-testid="table-group-header">
          <td colSpan={colCount} className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {group.label} {group.count != null && <span className="font-normal">({group.count})</span>}
          </td>
        </tr>
      )}
      {group.tasks.map((t) => (
        <tr
          key={t.id}
          data-testid="table-row"
          data-selected={selected.has(t.id) ? 'true' : undefined}
          className={cn(
            'border-b border-border/60 hover:bg-muted/30',
            selected.has(t.id) && 'bg-primary/5',
          )}
        >
          <td className="px-2 py-2 align-middle">
            <Checkbox
              size="sm"
              checked={selected.has(t.id)}
              onCheckedChange={() => onToggle(t.id)}
              aria-label={selectRowLabel(t.title)}
              data-testid="row-select"
            />
          </td>
          {columns.map((c) => (
            <td key={fieldKey(c)} className="px-3 py-2 align-middle text-foreground">
              <Cell task={t} field={c} customFields={customFields} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

function Cell({ task, field, customFields }: { task: Task; field: FieldRef; customFields: CustomField[] }) {
  const t = useTranslations('Views');
  const display = formatCellValue(taskFieldValue(task, field, customFields), t);
  if (display === '') return <span className="text-muted-foreground/60">—</span>;
  if (field.kind === 'builtin' && field.key === 'title') {
    return <span className="font-medium">{display}</span>;
  }
  return <span>{display}</span>;
}

/** Render a resolved field value as cell text. Custom-field values can be arrays
 *  (multi-select / people / labels) or booleans (checkbox); flatten both to a
 *  readable string. Empty / null / empty-array render as the "—" placeholder. */
function formatCellValue(v: unknown, t: ReturnType<typeof useTranslations<'Views'>>): string {
  if (v == null) return '';
  if (Array.isArray(v)) return v.map((x) => String(x)).join(', ');
  if (typeof v === 'boolean') return v ? t('table.yes') : t('table.no');
  return String(v);
}

function fieldKey(f: FieldRef): string {
  return `${f.kind}:${f.key}`;
}
