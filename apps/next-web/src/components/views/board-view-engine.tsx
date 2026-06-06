'use client';

/* ────────────────────────────────────────────────────────────────────────────
 * PARITY GATE — engine-backed Board (E5)
 *
 * This component renders the Views-engine Board. The four parity-checklist items
 * below are now SATISFIED; the legacy /board (board/page.tsx + board-view.tsx +
 * the bespoke getTasks path) is intentionally LEFT IN PLACE as the canonical
 * /board. The remaining cutover step — repointing /board at this engine and
 * deleting the legacy getTasks path — is DEFERRED: it needs inline create/delete
 * wiring (see remaining gaps) and reconciling /board's project scope with the
 * engine's saved-view scope, so it stays an explicit, human-gated decision.
 *
 * Parity checklist — all satisfied:
 *   [x] Same task set as the legacy getTasks board (engine getViewTasks returns
 *       the equivalent rows for the equivalent scope).
 *   [x] Columns come from the node's EFFECTIVE WORKFLOW statuses — resolved SSR
 *       (the scope's project = first segment of its materialized path) and
 *       threaded in via `workflowStatuses`. Falls back to the task set's distinct
 *       statuses only for EVERYTHING / a project with no workflow.
 *   [x] Filter by type / priority / free-text (title or issue key) — at parity
 *       with board-view.tsx's filter bar.
 *   [x] Drag-reorder persists card position + cross-column status moves via the
 *       SAME reorderTask action the legacy board uses.
 *   [x] Assignee avatars render: the viewTasks projection now carries per-task
 *       assignees, so assigneesByTaskId is populated.
 *
 * REMAINING gaps before a full /board cutover (track):
 *   - No inline "Create issue" / delete wiring (the engine surface owns task
 *     creation elsewhere); add/delete are no-ops here.
 *   - Optimistic move is local-only; canonical order is reconciled by the
 *     reorderTask revalidatePath('/board')+views revalidation on the next load.
 * ──────────────────────────────────────────────────────────────────────────── */

import { useCallback, useEffect, useMemo, useOptimistic, useRef, useState, useTransition } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Search, Filter, X } from 'lucide-react';

import { Board } from '@/components/Board';
import type { BoardColumn } from '@/components/Column';
import type { AssigneeRow } from '@/components/TaskCard';
import { reorderTask } from '@/server/actions/tasks';
import { useLiveTasks } from '@/lib/realtime/useLiveTasks';
import { notifyActionError } from '@/lib/apiErrorToast';
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
import type { ViewTaskPageResult } from '@/server/queries/views';
import type { Task } from '@/server/queries/normalize-task';
import type { SavedView, ViewScopeType } from '@projectflow/types';

/** Effective-workflow status shape threaded from the views page (parity with the
 *  legacy board's `columns` prop). Null/empty → derive columns from the task set. */
export type BoardWorkflowStatus = { id?: string; name?: string; title?: string; category?: string; position?: number };

// Mirror board-view.tsx's filter options so the engine board matches the legacy
// filter bar exactly.
const TYPE_OPTIONS     = ['EPIC', 'STORY', 'TASK', 'BUG', 'SUBTASK', 'IMPROVEMENT', 'FEATURE', 'TEST'] as const;
const PRIORITY_OPTIONS = ['HIGHEST', 'HIGH', 'MEDIUM', 'LOW', 'LOWEST'] as const;

// Same fallback column set + ordering board-view.tsx uses when no workflow is
// available. Doubles as the canonical left-to-right ordering for columns we
// derive from the task set (v1) so the layout is stable and predictable.
const FALLBACK_COLUMNS: BoardColumn[] = [
  { id: 'Ideas',       title: 'Ideas',       category: 'IDEA' },
  { id: 'To Do',       title: 'To Do',       category: 'TODO' },
  { id: 'In Progress', title: 'In Progress', category: 'IN_PROGRESS' },
  { id: 'Testing',     title: 'Testing',     category: 'TESTING' },
  { id: 'Done',        title: 'Done',        category: 'DONE' },
];

type OptimisticMove = { taskId: string; position: number; status?: string };

interface Props {
  taskPage: ViewTaskPageResult | null;
  activeView: SavedView;
  scopeId: string;
  scopeType: ViewScopeType;
  /** The scope's effective workflow statuses, resolved SSR. Null/empty falls back
   *  to deriving columns from the task set (e.g. EVERYTHING scope). */
  workflowStatuses?: BoardWorkflowStatus[] | null;
}

export function BoardViewEngine({ taskPage, activeView: _activeView, scopeId, scopeType: _scopeType, workflowStatuses }: Props) {
  const router       = useRouter();
  const pathname     = usePathname();
  const searchParams = useSearchParams();
  const t            = useTranslations('Views');
  const tBoard       = useTranslations('Board');

  // Enum → translated label maps (reuse the Board namespace's type/priority keys
  // so the filter dropdowns match TaskCard rather than rendering raw enum values).
  const TYPE_LABELS: Record<string, string> = {
    EPIC: tBoard('typeEpic'), STORY: tBoard('typeStory'), TASK: tBoard('typeTask'),
    BUG: tBoard('typeBug'), SUBTASK: tBoard('typeSubtask'), IMPROVEMENT: tBoard('typeImprovement'),
    FEATURE: tBoard('typeFeature'), TEST: tBoard('typeTest'),
  };
  const PRIORITY_LABELS: Record<string, string> = {
    HIGHEST: tBoard('priorityHighest'), HIGH: tBoard('priorityHigh'), MEDIUM: tBoard('priorityMedium'),
    LOW: tBoard('priorityLow'), LOWEST: tBoard('priorityLowest'),
  };

  const tasks = useMemo<Task[]>(() => taskPage?.tasks ?? [], [taskPage]);

  // Live `taskUpdated` deltas merged onto the SSR task set. `scopeId` is passed as
  // the subscription's projectId arg, but the server channel `task:updated` is
  // GLOBAL — the arg is just a required truthy placeholder; real scoping happens
  // client-side via mergeTaskDelta's id-match against the visible tasks. Using a
  // stable shared key (scopeId here, activeView.id on the other surfaces) lets
  // Apollo dedupe the single subscription across views.
  const liveTasks = useLiveTasks(scopeId, tasks);

  // ── Filter state (URL-persisted) — mirrors board-view.tsx ──────────────────
  const initialQ        = searchParams.get('q')        ?? '';
  const initialType     = searchParams.get('type')     ?? 'ALL';
  const initialPriority = searchParams.get('priority') ?? 'ALL';
  const [search,         setSearch]         = useState(initialQ);
  const [typeFilter,     setTypeFilter]     = useState<string>(initialType);
  const [priorityFilter, setPriorityFilter] = useState<string>(initialPriority);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const [, startTransition] = useTransition();

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

  // Debounce free-text search → URL write.
  useEffect(() => {
    if (search === initialQ) return;
    const t = setTimeout(() => writeFiltersToUrl({ q: search }), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  // Cmd/Ctrl+K focuses the filter input (parity with the legacy board).
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

  // ── Optimistic reorder (same pattern as board-view.tsx) ────────────────────
  const [optimisticTasks, applyMove] = useOptimistic(
    liveTasks,
    (state: Task[], m: OptimisticMove) =>
      state.map((t) =>
        t.id === m.taskId
          ? { ...t, position: m.position, ...(m.status !== undefined ? { status: m.status } : {}) }
          : t,
      ),
  );

  // ── Columns ────────────────────────────────────────────────────────────────
  // Prefer the scope's EFFECTIVE WORKFLOW statuses (resolved SSR and threaded in
  // via workflowStatuses) — same mapping the legacy board uses (sort by position,
  // status name is the column id tasks key on). When none is available (EVERYTHING
  // scope, or a scope whose project has no workflow) fall back to partitioning the
  // task set by distinct `status`, ordered by FALLBACK_COLUMNS.
  const boardColumns: BoardColumn[] = useMemo(() => {
    if (workflowStatuses && workflowStatuses.length > 0) {
      return [...workflowStatuses]
        .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
        .map((st): BoardColumn => {
          const name = st.name ?? st.title ?? st.id ?? '';
          return { id: name, title: name, category: st.category };
        });
    }

    const present = new Set(optimisticTasks.map((t) => t.status).filter(Boolean));
    if (present.size === 0) return FALLBACK_COLUMNS;

    const ordered: BoardColumn[] = [];
    const seen = new Set<string>();
    // Known fallback columns first, in their canonical order, when present.
    for (const c of FALLBACK_COLUMNS) {
      if (present.has(c.id)) { ordered.push(c); seen.add(c.id); }
    }
    // Then any extra statuses the task set carries that the fallback didn't cover.
    for (const t of optimisticTasks) {
      const st = t.status;
      if (st && !seen.has(st)) { ordered.push({ id: st, title: st }); seen.add(st); }
    }
    return ordered.length > 0 ? ordered : FALLBACK_COLUMNS;
  }, [workflowStatuses, optimisticTasks]);

  // ── Assignee avatars ───────────────────────────────────────────────────────
  // Build the assigneesByTaskId map the Board/TaskCard expects from the per-task
  // assignees the views projection now carries (PascalCase AssigneeRow shape).
  const assigneesByTaskId = useMemo(() => {
    const map: Record<string, AssigneeRow[]> = {};
    for (const t of tasks) {
      if (t.assignees.length === 0) continue;
      map[t.id] = t.assignees.map((a) => ({
        TaskId: t.id, UserId: a.userId, Name: a.name ?? '', Email: a.email ?? '', AvatarUrl: a.avatarUrl,
      }));
    }
    return map;
  }, [tasks]);

  // ── Local filters (type / priority / free-text) — parity with legacy ───────
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

  // ── Drag-reorder persistence — SAME action as board-view.tsx ───────────────
  function handleReorder(taskId: string, position: number, status: string | null) {
    startTransition(async () => {
      applyMove({ taskId, position, ...(status !== null ? { status } : {}) });
      const res = await reorderTask(taskId, position, status ?? undefined);
      if (!res.ok) notifyActionError(res);
    });
  }

  // Add / delete are not wired in v1 (the engine surface owns creation elsewhere).
  const noop = useCallback(() => {}, []);

  const activeFilterCount =
    (typeFilter !== 'ALL' ? 1 : 0) +
    (priorityFilter !== 'ALL' ? 1 : 0) +
    (search.trim() ? 1 : 0);

  return (
    <div data-testid="view-body-board" className="flex h-full flex-col gap-3">
      {/* ── Filter bar (mirrors board-view.tsx) ─────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/30 p-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            ref={searchInputRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('searchPlaceholder')}
            className="h-8 pl-7 pr-12 text-xs"
            aria-label={t('searchAriaLabel')}
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
          <SelectTrigger className="h-8 w-[130px] text-xs"><SelectValue placeholder={t('typePlaceholder')} /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">{t('allTypes')}</SelectItem>
            {TYPE_OPTIONS.map((opt) => (
              <SelectItem key={opt} value={opt}>{TYPE_LABELS[opt] ?? opt}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={priorityFilter}
          onValueChange={(v) => { setPriorityFilter(v); writeFiltersToUrl({ priority: v }); }}
        >
          <SelectTrigger className="h-8 w-[140px] text-xs"><SelectValue placeholder={t('priorityPlaceholder')} /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">{t('allPriorities')}</SelectItem>
            {PRIORITY_OPTIONS.map((opt) => (
              <SelectItem key={opt} value={opt}>{PRIORITY_LABELS[opt] ?? opt}</SelectItem>
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
              <X className="size-3.5" /> {t('clear')}
            </Button>
          </>
        )}

        <div className="ml-auto text-xs text-muted-foreground">
          {optimisticTasks.length > 0
            ? t.rich('showingOf', {
                shown: filteredTasks.length,
                total: optimisticTasks.length,
                strong: (chunks) => <strong className="text-foreground">{chunks}</strong>,
              })
            : ' '}
        </div>
      </div>

      {/* ── Board body (reuses Board → Column → TaskCard) ───────────────────── */}
      <div className="flex-1 min-h-0">
        <Board
          columns={boardColumns}
          initialTasks={filteredTasks as unknown[] as Record<string, unknown>[]}
          assigneesByTaskId={assigneesByTaskId}
          onReorderTask={handleReorder}
          onAddTask={noop}
          onDeleteTask={noop}
        />
      </div>
    </div>
  );
}
