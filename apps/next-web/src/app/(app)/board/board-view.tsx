'use client';

import {
  useCallback, useEffect, useMemo, useOptimistic, useRef, useState, useTransition,
} from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { LayoutGrid, Search, Filter, X } from 'lucide-react';

import { Board } from '@/components/Board';
import type { BoardColumn } from '@/components/Column';
import { TaskDrawer } from '@/components/TaskDrawer';
import { notifyApiError, notifyActionError } from '@/lib/apiErrorToast';
import { reorderTask, createTask, deleteTask } from '@/server/actions/tasks';
import {
  useSelectionBridge, WorkspaceProjectSwitcher,
} from '@/app/(app)/_components/selection-bridge';
import type { WorkspaceProjectContext } from '@/server/context';
import type { Task, AssigneeRow } from '@/server/queries/tasks';

import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

// ── Constants ─────────────────────────────────────────────────────────────────

const TYPE_OPTIONS     = ['EPIC', 'STORY', 'TASK', 'BUG', 'SUBTASK', 'IMPROVEMENT', 'FEATURE', 'TEST'] as const;
const PRIORITY_OPTIONS = ['HIGHEST', 'HIGH', 'MEDIUM', 'LOW', 'LOWEST'] as const;

const FALLBACK_COLUMNS: BoardColumn[] = [
  { id: 'Ideas',       title: 'Ideas',       category: 'IDEA' },
  { id: 'To Do',       title: 'To Do',       category: 'TODO' },
  { id: 'In Progress', title: 'In Progress', category: 'IN_PROGRESS' },
  { id: 'Testing',     title: 'Testing',     category: 'TESTING' },
  { id: 'Done',        title: 'Done',        category: 'DONE' },
];

// ── Types ─────────────────────────────────────────────────────────────────────

type OptimisticMove = { taskId: string; position: number; status?: string };

interface Props {
  ctx:               WorkspaceProjectContext;
  tasks:             Task[];
  assigneesByTaskId: Record<string, AssigneeRow[]>;
  /** Workflow statuses from the server, or null when there is no active project. */
  columns:           { id?: string; name?: string; title?: string; category?: string; position?: number }[] | null;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function BoardView({ ctx, tasks, assigneesByTaskId, columns: rawColumns }: Props) {
  const router       = useRouter();
  const pathname     = usePathname();
  const searchParams = useSearchParams();

  // Keep legacy zustand selection in sync with cookie/server truth until Phase 3.
  useSelectionBridge({
    activeWorkspaceId: ctx.activeWorkspaceId,
    activeProjectId:   ctx.activeProjectId,
    cookieWorkspaceId: ctx.cookieWorkspaceId,
    cookieProjectId:   ctx.cookieProjectId,
    workspaceIds:      ctx.workspaces.map((w) => w.id),
    projectIds:        ctx.projects.map((p) => p.id),
  });

  // ── Filter state (URL-persisted) ───────────────────────────────────────────
  const initialQ        = searchParams.get('q')        ?? '';
  const initialType     = searchParams.get('type')     ?? 'ALL';
  const initialPriority = searchParams.get('priority') ?? 'ALL';
  const [search,         setSearch]         = useState(initialQ);
  const [typeFilter,     setTypeFilter]     = useState<string>(initialType);
  const [priorityFilter, setPriorityFilter] = useState<string>(initialPriority);
  const [selectedTask,   setSelectedTask]   = useState<Task | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const [, startTransition] = useTransition();

  // Single source of truth for writing filter state into the URL.
  const writeFiltersToUrl = useCallback(
    (next: { q?: string; type?: string; priority?: string }) => {
      const params = new URLSearchParams(searchParams.toString());
      const setOrDelete = (key: string, value: string, isDefault: boolean) => {
        if (isDefault) params.delete(key);
        else           params.set(key, value);
      };
      if (next.q        !== undefined) setOrDelete('q',        next.q,        next.q.trim() === '');
      if (next.type     !== undefined) setOrDelete('type',     next.type,     next.type === 'ALL');
      if (next.priority !== undefined) setOrDelete('priority', next.priority, next.priority === 'ALL');
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  // Debounce search input → URL write.
  useEffect(() => {
    if (search === initialQ) return;
    const t = setTimeout(() => writeFiltersToUrl({ q: search }), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  // Cmd/Ctrl+K focuses the filter input.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // ── Optimistic reorder ─────────────────────────────────────────────────────
  const [optimisticTasks, applyMove] = useOptimistic(
    tasks,
    (state: Task[], m: OptimisticMove) =>
      state.map((t) =>
        t.id === m.taskId
          ? { ...t, position: m.position, ...(m.status !== undefined ? { status: m.status } : {}) }
          : t,
      ),
  );

  // ── Build columns from workflow (or fallback) ──────────────────────────────
  const boardColumns: BoardColumn[] = useMemo(() => {
    if (!rawColumns || rawColumns.length === 0) return FALLBACK_COLUMNS;
    return [...rawColumns]
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
      .map((s): BoardColumn => {
        const name = s.name ?? s.title ?? s.id ?? '';
        return { id: name, title: name, category: s.category };
      });
  }, [rawColumns]);

  // Apply local filters before handing tasks to the board.
  const filteredTasks = useMemo(() => {
    const q = search.trim().toLowerCase();
    return optimisticTasks.filter((t) => {
      if (typeFilter     !== 'ALL' && (t.type     ?? '') !== typeFilter)     return false;
      if (priorityFilter !== 'ALL' && (t.priority ?? '') !== priorityFilter) return false;
      if (q) {
        const hay = `${t.title ?? ''} ${t.issueKey ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [optimisticTasks, typeFilter, priorityFilter, search]);

  // ── Mutations ──────────────────────────────────────────────────────────────

  function handleReorder(taskId: string, position: number, status: string | null) {
    startTransition(async () => {
      applyMove({ taskId, position, ...(status !== null ? { status } : {}) });
      const res = await reorderTask(taskId, position, status ?? undefined);
      if (!res.ok) notifyActionError(res);
    });
  }

  // The POST /tasks Zod schema strips `status`, so all new cards land in the
  // default column ("To Do"). For non-default columns we follow the create
  // with a position PATCH that sets the correct status in one round-trip.
  const DEFAULT_STATUS = boardColumns[0]?.id ?? 'To Do';

  function handleAdd(columnId: string, content: string) {
    if (!ctx.activeProjectId) return;
    startTransition(async () => {
      const res = await createTask({
        title:       content,
        projectId:   ctx.activeProjectId!,
        workspaceId: ctx.activeWorkspaceId,
      });
      if (!res.ok) {
        notifyActionError(res);
        return;
      }
      // If the target column is not the default, move the new card into it.
      if (columnId !== DEFAULT_STATUS && res.data?.id) {
        const moveRes = await reorderTask(res.data.id, 0, columnId);
        if (!moveRes.ok) notifyActionError(moveRes);
      }
    });
  }

  function handleDelete(taskId: string) {
    startTransition(async () => {
      const res = await deleteTask(taskId);
      if (!res.ok) notifyActionError(res);
    });
  }

  // ── Derived UI state ───────────────────────────────────────────────────────
  const activeProject     = ctx.projects.find((p) => p.id === ctx.activeProjectId) ?? ctx.projects[0];
  const noProject         = !ctx.activeProjectId;
  const activeFilterCount =
    (typeFilter !== 'ALL' ? 1 : 0) +
    (priorityFilter !== 'ALL' ? 1 : 0) +
    (search.trim() ? 1 : 0);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-full flex-col gap-4">

      {/* ── Header ───────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <div className="rounded-lg bg-primary/10 p-2 text-primary">
            <LayoutGrid className="size-5" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>Board</span>
              {activeProject?.key && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono">{activeProject.key}</span>
                </>
              )}
            </div>
            <h2 className="text-base font-semibold text-foreground truncate">
              {activeProject?.name ?? 'No project'}
            </h2>
          </div>
        </div>

        {/* Workspace / project switchers */}
        <div className="flex flex-wrap items-center gap-2">
          <WorkspaceProjectSwitcher
            workspaces={ctx.workspaces}
            projects={ctx.projects}
            activeWorkspaceId={ctx.activeWorkspaceId}
            activeProjectId={ctx.activeProjectId}
          />
        </div>
      </div>

      {/* ── Filter bar ───────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/30 p-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            ref={searchInputRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search title or key…  (Ctrl/⌘+K)"
            className="h-8 pl-7 pr-12 text-xs"
            aria-label="Filter tasks by title or issue key"
          />
          <kbd
            aria-hidden="true"
            className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 select-none rounded border border-border bg-background px-1 py-px font-mono text-[9px] text-muted-foreground sm:inline-block"
          >
            ⌘K
          </kbd>
        </div>

        <Select
          value={typeFilter}
          onValueChange={(v) => { setTypeFilter(v); writeFiltersToUrl({ type: v }); }}
        >
          <SelectTrigger className="h-8 w-[130px] text-xs"><SelectValue placeholder="Type" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All types</SelectItem>
            {TYPE_OPTIONS.map((t) => (
              <SelectItem key={t} value={t}>{t.charAt(0) + t.slice(1).toLowerCase()}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={priorityFilter}
          onValueChange={(v) => { setPriorityFilter(v); writeFiltersToUrl({ priority: v }); }}
        >
          <SelectTrigger className="h-8 w-[140px] text-xs"><SelectValue placeholder="Priority" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All priorities</SelectItem>
            {PRIORITY_OPTIONS.map((p) => (
              <SelectItem key={p} value={p}>{p.charAt(0) + p.slice(1).toLowerCase()}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {activeFilterCount > 0 && (
          <>
            <Badge variant="outline" size="sm" appearance="outline" className="ml-1">
              <Filter className="size-3" />
              {activeFilterCount}
            </Badge>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setSearch('');
                setTypeFilter('ALL');
                setPriorityFilter('ALL');
                writeFiltersToUrl({ q: '', type: 'ALL', priority: 'ALL' });
              }}
              className="h-8 px-2 text-xs"
            >
              <X className="size-3.5" /> Clear
            </Button>
          </>
        )}

        <div className="ml-auto text-xs text-muted-foreground">
          {optimisticTasks.length > 0
            ? <>Showing <strong className="text-foreground">{filteredTasks.length}</strong> of <strong className="text-foreground">{optimisticTasks.length}</strong></>
            : ' '}
        </div>
      </div>

      {/* ── Body ─────────────────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0">
        {noProject ? (
          <EmptyProjectState />
        ) : (
          <Board
            columns={boardColumns}
            initialTasks={filteredTasks as any[]}
            assigneesByTaskId={assigneesByTaskId as any}
            onReorderTask={handleReorder}
            onAddTask={handleAdd}
            onDeleteTask={handleDelete}
            onOpenTask={(task) => setSelectedTask(task as unknown as Task)}
          />
        )}
      </div>

      <TaskDrawer
        task={selectedTask as any}
        assignees={
          (selectedTask
            ? (assigneesByTaskId[String((selectedTask as any).Id ?? (selectedTask as any).id ?? '')] ?? [])
            : []) as any
        }
        workspaceId={ctx.activeWorkspaceId}
        onClose={() => setSelectedTask(null)}
      />
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function EmptyProjectState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border p-8 text-center">
      <LayoutGrid className="size-10 text-muted-foreground/50" aria-hidden="true" />
      <div className="space-y-1">
        <div className="text-sm font-medium text-foreground">No project to show</div>
        <div className="text-xs text-muted-foreground max-w-sm">
          Create a project in this workspace to start tracking issues on the board.
        </div>
      </div>
    </div>
  );
}
