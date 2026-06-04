'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { LayoutGrid } from 'lucide-react';

import { ViewTabs } from '@/components/views/view-tabs';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { ViewTaskPageResult } from '@/server/queries/views';
import type { Task } from '@/server/queries/normalize-task';
import type { SavedView, ViewScopeType, ViewType } from '@projectflow/types';

interface Props {
  views: SavedView[];
  activeViewId: string | null;
  scopeType: ViewScopeType;
  scopeId: string;
  page: number;
  meMode: boolean;
  /** Paged tasks for the active view, or null when no view is active. */
  taskPage: ViewTaskPageResult | null;
}

export function ViewSurface({
  views,
  activeViewId,
  scopeType,
  scopeId,
  meMode,
  taskPage,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const activeView = views.find((v) => v.id === activeViewId) ?? null;

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
        <Button
          type="button"
          size="sm"
          variant={meMode ? 'primary' : 'outline'}
          onClick={toggleMeMode}
          data-testid="me-mode-toggle"
          aria-pressed={meMode}
          className="h-8 shrink-0 text-xs"
        >
          Me mode
        </Button>
      </div>

      <div className="flex-1 min-h-0">
        {activeView ? (
          <ViewBody type={activeView.type} taskPage={taskPage} />
        ) : (
          <EmptyViewsState />
        )}
      </div>
    </div>
  );
}

// ── View body ─────────────────────────────────────────────────────────────────
// The real per-type view components (TableView / ListView / CalendarView /
// BoardViewEngine) are built in E3/E4/E5. Until then each branch renders a
// typecheck-safe placeholder that lists the active view's tasks (title + status).
//
// PROP CONTRACT (what E3/E4/E5 must accept when they swap in the real component):
//   props: { taskPage: ViewTaskPageResult | null }
//     where ViewTaskPageResult = { total: number; tasks: Task[]; groups: ViewGroup[] }
//   `tasks` are normalize-task `Task` objects (camelCase: id, title, status, …).
//   `taskPage` is null only when there is no active view (handled by the caller).

function ViewBody({ type, taskPage }: { type: ViewType; taskPage: ViewTaskPageResult | null }) {
  switch (type) {
    case 'table':
      // TODO(E4): replace with <TableView taskPage={taskPage} />
      return <PlaceholderBody type={type} testId="view-body-table" taskPage={taskPage} />;
    case 'list':
      // TODO(E3): replace with <ListView taskPage={taskPage} />
      return <PlaceholderBody type={type} testId="view-body-list" taskPage={taskPage} />;
    case 'calendar':
      // TODO(E5): replace with <CalendarView taskPage={taskPage} />
      return <PlaceholderBody type={type} testId="view-body-calendar" taskPage={taskPage} />;
    case 'board':
      // TODO(E5): replace with <BoardViewEngine taskPage={taskPage} />
      return <PlaceholderBody type={type} testId="view-body-board" taskPage={taskPage} />;
    default:
      return <PlaceholderBody type={type} testId="view-body-list" taskPage={taskPage} />;
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
