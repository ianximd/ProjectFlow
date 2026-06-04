'use client';

import { useCallback, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { LayoutGrid, SlidersHorizontal } from 'lucide-react';

import { ViewTabs } from '@/components/views/view-tabs';
import { TableView } from '@/components/views/table-view';
import { ListView } from '@/components/views/list-view';
import { CalendarView } from '@/components/views/calendar-view';
import { FilterBuilder } from '@/components/views/filter-builder';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { ViewTaskPageResult } from '@/server/queries/views';
import type { Task } from '@/server/queries/normalize-task';
import type { CustomField, SavedView, ViewScopeType, ViewType } from '@projectflow/types';

interface Props {
  views: SavedView[];
  activeViewId: string | null;
  scopeType: ViewScopeType;
  scopeId: string;
  meMode: boolean;
  /** Paged tasks for the active view, or null when no view is active. */
  taskPage: ViewTaskPageResult | null;
  /** The scope's custom fields, fetched SSR in page.tsx and threaded down for the
   *  table/list columns + the filter-builder's field options. */
  customFields: CustomField[];
}

export function ViewSurface({
  views,
  activeViewId,
  scopeType,
  scopeId,
  meMode,
  taskPage,
  customFields,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const activeView = views.find((v) => v.id === activeViewId) ?? null;

  // Bulk-bar selection (E6 consumes this). TableView/ListView own their own
  // selection set and report it up via onSelectionChange.
  const [, setSelectedIds] = useState<string[]>([]);
  const onSelectionChange = useCallback((ids: string[]) => setSelectedIds(ids), []);

  // Filter-builder panel is collapsible (table/list only).
  const [builderOpen, setBuilderOpen] = useState(false);

  // Me-mode toggle: set ?meMode=1 or remove it, preserving other params (mirrors
  // board-view.tsx's writeFiltersToUrl pattern).
  const toggleMeMode = () => {
    const params = new URLSearchParams(searchParams.toString());
    if (meMode) params.delete('meMode');
    else params.set('meMode', '1');
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  // Empty scope: no saved views yet — just the tab row's "New view" affordance.
  if (views.length === 0) {
    return (
      <div className="flex h-full flex-col gap-4">
        <ViewTabs views={views} activeViewId={null} scopeType={scopeType} scopeId={scopeId} />
        <EmptyViewsState />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <ViewTabs
          views={views}
          activeViewId={activeViewId}
          scopeType={scopeType}
          scopeId={scopeId}
        />
        <div className="flex shrink-0 items-center gap-2">
          {activeView && (activeView.type === 'table' || activeView.type === 'list') && (
            <Button
              type="button"
              size="sm"
              variant={builderOpen ? 'primary' : 'outline'}
              onClick={() => setBuilderOpen((o) => !o)}
              data-testid="filter-builder-toggle"
              aria-pressed={builderOpen}
              className="h-8 text-xs"
            >
              <SlidersHorizontal className="size-3.5" /> Customize
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            variant={meMode ? 'primary' : 'outline'}
            onClick={toggleMeMode}
            data-testid="me-mode-toggle"
            aria-pressed={meMode}
            className="h-8 text-xs"
          >
            Me mode
          </Button>
        </div>
      </div>

      {activeView && builderOpen && (activeView.type === 'table' || activeView.type === 'list') && (
        <FilterBuilder
          key={activeView.id}
          activeView={activeView}
          scopeType={scopeType}
          scopeId={scopeId}
          customFields={customFields}
          meMode={meMode}
        />
      )}

      <div className="flex-1 min-h-0">
        {activeView ? (
          <ViewBody
            type={activeView.type}
            taskPage={taskPage}
            activeView={activeView}
            customFields={customFields}
            onSelectionChange={onSelectionChange}
          />
        ) : (
          <EmptyViewsState />
        )}
      </div>
    </div>
  );
}

// ── View body ─────────────────────────────────────────────────────────────────
// Table + List are now real components (E3). Calendar (E5) and Board (E4) still
// render the typecheck-safe placeholder until those tasks land.
//
// PROP CONTRACT for the real components:
//   { taskPage: ViewTaskPageResult | null; activeView: SavedView;
//     customFields: CustomField[]; onSelectionChange?: (ids: string[]) => void }
//   `tasks` are normalize-task `Task` objects (camelCase). `taskPage` is null only
//   when there is no active view (handled by the caller).

function ViewBody({
  type,
  taskPage,
  activeView,
  customFields,
  onSelectionChange,
}: {
  type: ViewType;
  taskPage: ViewTaskPageResult | null;
  activeView: SavedView;
  customFields: CustomField[];
  onSelectionChange?: (ids: string[]) => void;
}) {
  switch (type) {
    case 'table':
      return (
        <TableView
          taskPage={taskPage}
          activeView={activeView}
          customFields={customFields}
          onSelectionChange={onSelectionChange}
        />
      );
    case 'list':
      return (
        <ListView
          taskPage={taskPage}
          activeView={activeView}
          customFields={customFields}
          onSelectionChange={onSelectionChange}
        />
      );
    case 'calendar':
      return (
        <CalendarView taskPage={taskPage} activeView={activeView} customFields={customFields} />
      );
    case 'board':
      // TODO(E4): replace with <BoardViewEngine ... />
      return <PlaceholderBody type={type} testId="view-body-board" taskPage={taskPage} />;
    default:
      return (
        <ListView
          taskPage={taskPage}
          activeView={activeView}
          customFields={customFields}
          onSelectionChange={onSelectionChange}
        />
      );
  }
}

function PlaceholderBody({
  type,
  testId,
  taskPage,
}: {
  type: ViewType;
  testId: string;
  taskPage: ViewTaskPageResult | null;
}) {
  const tasks: Task[] = taskPage?.tasks ?? [];
  return (
    <div
      data-testid={testId}
      className="flex h-full flex-col gap-2 rounded-lg border border-border bg-muted/20 p-3"
    >
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {type} view ({taskPage?.total ?? 0})
      </div>
      {tasks.length === 0 ? (
        <div className="text-xs text-muted-foreground">No tasks.</div>
      ) : (
        <ul className="flex flex-col gap-1">
          {tasks.map((t) => (
            <li
              key={t.id}
              data-testid="view-task-row"
              className="flex items-center justify-between gap-3 rounded border border-border bg-background px-2 py-1 text-xs"
            >
              <span className="truncate text-foreground">{t.title}</span>
              <span className="shrink-0 text-muted-foreground">{t.status}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function EmptyViewsState() {
  return (
    <div
      data-testid="views-empty"
      className={cn(
        'flex h-full flex-col items-center justify-center gap-3 rounded-lg',
        'border border-dashed border-border p-8 text-center',
      )}
    >
      <LayoutGrid className="size-10 text-muted-foreground/50" aria-hidden="true" />
      <div className="space-y-1">
        <div className="text-sm font-medium text-foreground">No views yet</div>
        <div className="max-w-sm text-xs text-muted-foreground">
          Create a view to start exploring tasks in this scope.
        </div>
      </div>
    </div>
  );
}
