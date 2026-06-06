'use client';

import { useCallback, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { LayoutGrid, SlidersHorizontal } from 'lucide-react';

import { ViewTabs } from '@/components/views/view-tabs';
import { TableView } from '@/components/views/table-view';
import { ListView } from '@/components/views/list-view';
import { CalendarView } from '@/components/views/calendar-view';
import { BoardViewEngine, type BoardWorkflowStatus } from '@/components/views/board-view-engine';
import { FilterBuilder } from '@/components/views/filter-builder';
import { BulkBar } from '@/components/views/bulk-bar';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { ViewTaskPageResult } from '@/server/queries/views';
import type { CustomField, SavedView, ViewScopeType, ViewType } from '@projectflow/types';

interface Props {
  views: SavedView[];
  activeViewId: string | null;
  scopeType: ViewScopeType;
  scopeId: string;
  /** Workspace id for EVERYTHING-scoped create/preview (those fail closed without
   *  it). Undefined for node-scoped views, whose authority is the node ACL. */
  workspaceId?: string;
  meMode: boolean;
  /** Paged tasks for the active view, or null when no view is active. */
  taskPage: ViewTaskPageResult | null;
  /** The scope's custom fields, fetched SSR in page.tsx and threaded down for the
   *  table/list columns + the filter-builder's field options. */
  customFields: CustomField[];
  /** The scope's effective workflow statuses (board views only), resolved SSR.
   *  Null when not a board view, EVERYTHING scope, or the project has no workflow. */
  boardWorkflowStatuses?: BoardWorkflowStatus[] | null;
}

export function ViewSurface({
  views,
  activeViewId,
  scopeType,
  scopeId,
  workspaceId,
  meMode,
  taskPage,
  customFields,
  boardWorkflowStatuses,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const t = useTranslations('Views');

  const activeView = views.find((v) => v.id === activeViewId) ?? null;

  // Bulk-bar selection (E6 consumes this). TableView/ListView own their own
  // selection set and report it up via onSelectionChange; we lift it here so the
  // BulkBar can act on it and clear it after a successful bulk action.
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const onSelectionChange = useCallback((ids: string[]) => setSelectedIds(ids), []);

  // After a bulk action: drop the local selection and pull fresh SSR data (the
  // child table/list re-renders with the updated rows and prunes stale ids).
  const onBulkDone = useCallback(() => {
    setSelectedIds([]);
    router.refresh();
  }, [router]);

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
        <ViewTabs views={views} activeViewId={null} scopeType={scopeType} scopeId={scopeId} workspaceId={workspaceId} />
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
          workspaceId={workspaceId}
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
              <SlidersHorizontal className="size-3.5" /> {t('customize')}
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
            {t('meMode')}
          </Button>
        </div>
      </div>

      {activeView && builderOpen && (activeView.type === 'table' || activeView.type === 'list') && (
        <FilterBuilder
          key={activeView.id}
          activeView={activeView}
          scopeType={scopeType}
          scopeId={scopeId}
          workspaceId={workspaceId}
          customFields={customFields}
          meMode={meMode}
        />
      )}

      {selectedIds.length > 0 && (
        <BulkBar
          selectedIds={selectedIds}
          scopeType={scopeType}
          scopeId={scopeId}
          onDone={onBulkDone}
        />
      )}

      <div className="flex-1 min-h-0">
        {activeView ? (
          <ViewBody
            type={activeView.type}
            taskPage={taskPage}
            activeView={activeView}
            customFields={customFields}
            scopeType={scopeType}
            scopeId={scopeId}
            boardWorkflowStatuses={boardWorkflowStatuses}
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
// Table, List, Calendar, and Board are all real components now. Board (E5) is the
// engine-backed BoardViewEngine, rendered behind a parity gate — the legacy
// /board (board/page.tsx + board-view.tsx) is unchanged and still canonical.
//
// PROP CONTRACT for the real components:
//   { taskPage: ViewTaskPageResult | null; activeView: SavedView;
//     customFields: CustomField[]; onSelectionChange?: (ids: string[]) => void }
//   Board additionally receives scopeType/scopeId.
//   `tasks` are normalize-task `Task` objects (camelCase). `taskPage` is null only
//   when there is no active view (handled by the caller).

function ViewBody({
  type,
  taskPage,
  activeView,
  customFields,
  scopeType,
  scopeId,
  boardWorkflowStatuses,
  onSelectionChange,
}: {
  type: ViewType;
  taskPage: ViewTaskPageResult | null;
  activeView: SavedView;
  customFields: CustomField[];
  scopeType: ViewScopeType;
  scopeId: string;
  boardWorkflowStatuses?: BoardWorkflowStatus[] | null;
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
      return (
        <BoardViewEngine
          taskPage={taskPage}
          activeView={activeView}
          scopeType={scopeType}
          scopeId={scopeId}
          workflowStatuses={boardWorkflowStatuses}
        />
      );
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

function EmptyViewsState() {
  const t = useTranslations('Views');
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
        <div className="text-sm font-medium text-foreground">{t('noViewsTitle')}</div>
        <div className="max-w-sm text-xs text-muted-foreground">
          {t('noViewsBody')}
        </div>
      </div>
    </div>
  );
}
