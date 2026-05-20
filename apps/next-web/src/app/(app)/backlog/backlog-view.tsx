'use client';

import {
  useCallback, useEffect, useMemo, useOptimistic, useRef, useState, useTransition,
} from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  List, Search, Filter, X, Plus, Trash2,
  Bug, Bookmark, CheckSquare, Award, GitBranch, Sparkles, Zap, FlaskConical,
  Calendar, ChevronDown, ChevronRight,
} from 'lucide-react';

import { notifyActionError } from '@/lib/apiErrorToast';
import { createTask, deleteTask, updateTaskPriority } from '@/server/actions/tasks';
import {
  useSelectionBridge, WorkspaceProjectSwitcher,
} from '@/app/(app)/_components/selection-bridge';
import type { WorkspaceProjectContext } from '@/server/context';
import type { Task, AssigneeRow } from '@/server/queries/tasks';
import type { Sprint } from '@/server/queries/sprints';
import { TaskDrawer } from '@/components/TaskDrawer';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Card } from '@/components/ui/card';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

// ── Lookup tables ────────────────────────────────────────────────────────────

const TYPE_OPTIONS     = ['EPIC', 'STORY', 'TASK', 'BUG', 'SUBTASK', 'IMPROVEMENT', 'FEATURE', 'TEST'] as const;
const PRIORITY_OPTIONS = ['HIGHEST', 'HIGH', 'MEDIUM', 'LOW', 'LOWEST'] as const;

const TYPE_META: Record<string, { Icon: typeof Bug; classes: string; label: string }> = {
  BUG:         { Icon: Bug,          classes: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300',                label: 'Bug' },
  STORY:       { Icon: Bookmark,     classes: 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300',        label: 'Story' },
  TASK:        { Icon: CheckSquare,  classes: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300',            label: 'Task' },
  EPIC:        { Icon: Award,        classes: 'bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300',    label: 'Epic' },
  SUBTASK:     { Icon: GitBranch,    classes: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-950 dark:text-cyan-300',            label: 'Subtask' },
  IMPROVEMENT: { Icon: Sparkles,     classes: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300',        label: 'Improvement' },
  FEATURE:     { Icon: Zap,          classes: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300',    label: 'Feature' },
  TEST:        { Icon: FlaskConical, classes: 'bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300',    label: 'Test' },
};

const PRIORITY_META: Record<string, { dot: string; label: string }> = {
  HIGHEST: { dot: 'bg-red-500',    label: 'Highest' },
  HIGH:    { dot: 'bg-orange-500', label: 'High' },
  MEDIUM:  { dot: 'bg-amber-500',  label: 'Medium' },
  LOW:     { dot: 'bg-sky-500',    label: 'Low' },
  LOWEST:  { dot: 'bg-slate-400',  label: 'Lowest' },
};

const STATUS_META: Record<string, string> = {
  'To Do':       'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  'In Progress': 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300',
  'Done':        'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
  'Blocked':     'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300',
};

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

// Optimistic mutations applied to the server-rendered task list until
// revalidatePath rebases it (delete removes the row; priority recolors the dot).
type OptimisticAction =
  | { type: 'delete'; id: string }
  | { type: 'priority'; id: string; priority: string };

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  ctx:               WorkspaceProjectContext;
  tasks:             Task[];
  assigneesByTaskId: Record<string, AssigneeRow[]>;
  sprints:           Sprint[];
}

// ── View ──────────────────────────────────────────────────────────────────────

export function BacklogView({ ctx, tasks, assigneesByTaskId, sprints }: Props) {
  const router       = useRouter();
  const pathname     = usePathname();
  const searchParams = useSearchParams();

  // Keep legacy zustand selection in sync with the cookie/server truth until Phase 3.
  useSelectionBridge({
    activeWorkspaceId: ctx.activeWorkspaceId,
    activeProjectId:   ctx.activeProjectId,
    cookieWorkspaceId: ctx.cookieWorkspaceId,
    cookieProjectId:   ctx.cookieProjectId,
    workspaceIds:      ctx.workspaces.map((w) => w.id),
    projectIds:        ctx.projects.map((p) => p.id),
  });

  // URL-persisted filters: a refresh or shared link restores the same view.
  const initialQ        = searchParams.get('q')        ?? '';
  const initialType     = searchParams.get('type')     ?? 'ALL';
  const initialPriority = searchParams.get('priority') ?? 'ALL';
  const [search,         setSearch]         = useState(initialQ);
  const [typeFilter,     setTypeFilter]     = useState<string>(initialType);
  const [priorityFilter, setPriorityFilter] = useState<string>(initialPriority);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [collapsed,    setCollapsed]    = useState<Record<string, boolean>>({});
  const [creatingFor,  setCreatingFor]  = useState<string | null>(null);  // sprintId or "BACKLOG"
  const [isCreating,   setIsCreating]   = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const [, startTransition] = useTransition();
  const [optimisticTasks, applyOptimistic] = useOptimistic(
    tasks,
    (state: Task[], action: OptimisticAction): Task[] =>
      action.type === 'delete'
        ? state.filter((t) => t.id !== action.id)
        : state.map((t) => (t.id === action.id ? { ...t, priority: action.priority } : t)),
  );

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
      // router.replace (not push) so back-button history stays usable.
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  useEffect(() => {
    if (search === initialQ) return; // initial mount sync — skip URL write
    const t = setTimeout(() => writeFiltersToUrl({ q: search }), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  // Cmd/Ctrl+K focuses the filter input — same shortcut as Board for consistency.
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

  const activeProject = ctx.projects.find((p) => p.id === ctx.activeProjectId) ?? ctx.projects[0];

  // ── Local filter pipeline ──────────────────────────────────────────────────
  const filteredTasks = useMemo(() => {
    const q = search.trim().toLowerCase();
    return optimisticTasks.filter((t) => {
      if (typeFilter     !== 'ALL' && t.type     !== typeFilter)     return false;
      if (priorityFilter !== 'ALL' && t.priority !== priorityFilter) return false;
      if (q) {
        const hay = `${t.title ?? ''} ${t.issueKey ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [optimisticTasks, typeFilter, priorityFilter, search]);

  // Group by section: ACTIVE/PLANNED sprints first, then Backlog (no sprintId).
  // COMPLETED sprints are hidden — the historical view lives on the dashboard.
  const sections = useMemo(() => {
    const visibleSprints = sprints
      .filter((s) => s.status !== 'COMPLETED')
      .sort((a, b) => {
        if (a.status !== b.status) return a.status === 'ACTIVE' ? -1 : 1;
        const da = a.startDate ? new Date(a.startDate).getTime() : Number.MAX_SAFE_INTEGER;
        const db = b.startDate ? new Date(b.startDate).getTime() : Number.MAX_SAFE_INTEGER;
        return da - db;
      });

    const bySprint: Record<string, Task[]> = {};
    const backlog: Task[] = [];
    for (const t of filteredTasks) {
      if (t.sprintId) (bySprint[t.sprintId] ?? (bySprint[t.sprintId] = [])).push(t);
      else            backlog.push(t);
    }

    const sprintSections = visibleSprints.map((s) => ({
      key:    s.id,
      kind:   'SPRINT' as const,
      sprint: s,
      title:  s.name,
      tasks:  bySprint[s.id] ?? [],
    }));

    return [
      ...sprintSections,
      { key: 'BACKLOG', kind: 'BACKLOG' as const, sprint: null, title: 'Backlog', tasks: backlog },
    ];
  }, [filteredTasks, sprints]);

  // ── Mutations ──────────────────────────────────────────────────────────────
  function handleCreate(title: string, sprintId: string | null) {
    if (!ctx.activeProjectId) return;
    setIsCreating(true);
    startTransition(async () => {
      const res = await createTask({
        title,
        projectId:   ctx.activeProjectId!,
        workspaceId: ctx.activeWorkspaceId,
        sprintId:    sprintId ?? undefined,
      });
      setIsCreating(false);
      if (!res.ok) notifyActionError(res);
      else setCreatingFor(null);
    });
  }

  function handleDelete(id: string) {
    if (!window.confirm('Delete this issue?')) return;
    startTransition(async () => {
      applyOptimistic({ type: 'delete', id });
      const res = await deleteTask(id);
      if (!res.ok) notifyActionError(res);
    });
  }

  function handlePriorityChange(id: string, priority: string) {
    startTransition(async () => {
      applyOptimistic({ type: 'priority', id, priority });
      const res = await updateTaskPriority(id, priority);
      if (!res.ok) notifyActionError(res);
    });
  }

  // ── Derived UI state ───────────────────────────────────────────────────────
  const noProject = !ctx.activeProjectId;
  const activeFilterCount =
    (typeFilter !== 'ALL' ? 1 : 0) +
    (priorityFilter !== 'ALL' ? 1 : 0) +
    (search.trim() ? 1 : 0);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-full flex-col gap-4">
      {/* ── Header + switchers ─────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <div className="rounded-lg bg-primary/10 p-2 text-primary">
            <List className="size-5" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>Backlog</span>
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

        <div className="flex flex-wrap items-center gap-2">
          <WorkspaceProjectSwitcher
            workspaces={ctx.workspaces}
            projects={ctx.projects}
            activeWorkspaceId={ctx.activeWorkspaceId}
            activeProjectId={ctx.activeProjectId}
          />
        </div>
      </div>

      {/* ── Filter bar ─────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/30 p-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            ref={searchInputRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search title or key…  (Ctrl/⌘+K)"
            className="h-8 pl-7 pr-12 text-xs"
            aria-label="Filter backlog by title or issue key"
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
            {TYPE_OPTIONS.map((t) => <SelectItem key={t} value={t}>{TYPE_META[t]?.label ?? t}</SelectItem>)}
          </SelectContent>
        </Select>

        <Select
          value={priorityFilter}
          onValueChange={(v) => { setPriorityFilter(v); writeFiltersToUrl({ priority: v }); }}
        >
          <SelectTrigger className="h-8 w-[140px] text-xs"><SelectValue placeholder="Priority" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All priorities</SelectItem>
            {PRIORITY_OPTIONS.map((p) => <SelectItem key={p} value={p}>{PRIORITY_META[p]?.label ?? p}</SelectItem>)}
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
          Showing <strong className="text-foreground">{filteredTasks.length}</strong> of <strong className="text-foreground">{optimisticTasks.length}</strong>
        </div>
      </div>

      {/* ── Body ───────────────────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {noProject ? (
          <EmptyProjectState />
        ) : (
          <div className="flex flex-col gap-4">
            {sections.map((s) => (
              <Section
                key={s.key}
                section={s}
                assigneesByTaskId={assigneesByTaskId}
                isCollapsed={!!collapsed[s.key]}
                onToggleCollapse={() => setCollapsed((prev) => ({ ...prev, [s.key]: !prev[s.key] }))}
                creatingFor={creatingFor}
                onStartCreate={() => setCreatingFor(s.kind === 'BACKLOG' ? 'BACKLOG' : s.sprint!.id)}
                onCancelCreate={() => setCreatingFor(null)}
                onSubmitCreate={(title) => handleCreate(title, s.kind === 'SPRINT' ? s.sprint!.id : null)}
                isCreating={isCreating}
                onOpenTask={setSelectedTask}
                onDeleteTask={handleDelete}
                onPriorityChange={handlePriorityChange}
              />
            ))}
          </div>
        )}
      </div>

      <TaskDrawer
        task={selectedTask as any}
        assignees={(selectedTask ? assigneesByTaskId[selectedTask.id] ?? [] : []) as any}
        workspaceId={ctx.activeWorkspaceId}
        onClose={() => setSelectedTask(null)}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Section (sprint or backlog)
// ─────────────────────────────────────────────────────────────────────────────

type SectionData =
  | { key: string; kind: 'SPRINT';  sprint: Sprint; title: string; tasks: Task[] }
  | { key: string; kind: 'BACKLOG'; sprint: null;   title: string; tasks: Task[] };

function Section({
  section, assigneesByTaskId, isCollapsed, onToggleCollapse,
  creatingFor, onStartCreate, onCancelCreate, onSubmitCreate, isCreating,
  onOpenTask, onDeleteTask, onPriorityChange,
}: {
  section: SectionData;
  assigneesByTaskId: Record<string, AssigneeRow[]>;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  creatingFor: string | null;
  onStartCreate: () => void;
  onCancelCreate: () => void;
  onSubmitCreate: (title: string) => void;
  isCreating: boolean;
  onOpenTask: (t: Task) => void;
  onDeleteTask: (id: string) => void;
  onPriorityChange: (id: string, priority: string) => void;
}) {
  const totalPoints = section.tasks.reduce((acc, t) => acc + (t.storyPoints ?? 0), 0);
  const isCreatingHere = creatingFor === section.key
    || (section.kind === 'SPRINT' && creatingFor === section.sprint!.id)
    || (section.kind === 'BACKLOG' && creatingFor === 'BACKLOG');

  return (
    <Card className="overflow-hidden">
      {/* The collapse trigger and the Add-issue button are siblings inside a
          flex row — never nested — to avoid HTML's "no <button> in <button>"
          rule (React/Next surfaces it as a hydration error). */}
      <div className="flex items-center gap-2 px-4 py-2.5 hover:bg-muted/30 transition-colors">
        <button
          type="button"
          onClick={onToggleCollapse}
          className="flex items-center gap-2 text-left flex-1 min-w-0"
          aria-expanded={!isCollapsed}
        >
          {isCollapsed
            ? <ChevronRight className="size-4 text-muted-foreground shrink-0" aria-hidden="true" />
            : <ChevronDown  className="size-4 text-muted-foreground shrink-0" aria-hidden="true" />}

          <h3 className="text-sm font-semibold text-foreground truncate">{section.title}</h3>

          {section.kind === 'SPRINT' && <SprintMeta sprint={section.sprint} />}

          <Badge variant="outline" size="xs" appearance="outline" className="ml-1 font-normal">
            {section.tasks.length} {section.tasks.length === 1 ? 'issue' : 'issues'}
          </Badge>
          {totalPoints > 0 && (
            <Badge variant="outline" size="xs" appearance="outline" className="font-mono">
              {Number.isInteger(totalPoints) ? totalPoints : totalPoints.toFixed(1)} pt
            </Badge>
          )}
        </button>

        <Button
          size="sm"
          variant="ghost"
          onClick={onStartCreate}
          className="h-7 px-2 text-xs shrink-0"
          aria-label={`Add issue to ${section.title}`}
        >
          <Plus className="size-3.5" /> Add issue
        </Button>
      </div>

      {!isCollapsed && (
        <div className="border-t border-border/60">
          {section.tasks.length === 0 && !isCreatingHere && (
            <div className="px-4 py-6 text-center text-xs text-muted-foreground">
              {section.kind === 'BACKLOG'
                ? 'No issues in the backlog. Add one to get started.'
                : 'No issues in this sprint yet.'}
            </div>
          )}

          {section.tasks.map((t) => (
            <Row
              key={t.id}
              task={t}
              assignees={assigneesByTaskId[t.id] ?? []}
              onOpen={() => onOpenTask(t)}
              onDelete={() => onDeleteTask(t.id)}
              onPriorityChange={(p) => onPriorityChange(t.id, p)}
            />
          ))}

          {isCreatingHere && (
            <InlineCreate isPending={isCreating} onCancel={onCancelCreate} onSubmit={onSubmitCreate} />
          )}
        </div>
      )}
    </Card>
  );
}

function SprintMeta({ sprint }: { sprint: Sprint }) {
  const cls = sprint.status === 'ACTIVE'
    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
    : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300';
  return (
    <>
      <span className={cn('inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide', cls)}>
        {sprint.status === 'ACTIVE' ? 'Active' : 'Planned'}
      </span>
      {(sprint.startDate || sprint.endDate) && (
        <span className="hidden md:inline-flex items-center gap-1 text-xs text-muted-foreground">
          <Calendar className="size-3" />
          {sprint.startDate?.slice(0, 10) ?? '?'} → {sprint.endDate?.slice(0, 10) ?? '?'}
        </span>
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// One backlog row
// ─────────────────────────────────────────────────────────────────────────────

function Row({
  task, assignees, onOpen, onDelete, onPriorityChange,
}: {
  task: Task;
  assignees: AssigneeRow[];
  onOpen: () => void;
  onDelete: () => void;
  onPriorityChange: (priority: string) => void;
}) {
  const type     = String(task.type ?? 'TASK').toUpperCase();
  const priority = String(task.priority ?? 'MEDIUM').toUpperCase();
  const status   = String(task.status ?? 'To Do');
  const title    = task.title || '(untitled)';
  const issueKey = task.issueKey;
  const points   = task.storyPoints;

  const tm = TYPE_META[type] ?? TYPE_META.TASK!;
  const pm = PRIORITY_META[priority] ?? PRIORITY_META.MEDIUM!;
  const TypeIcon = tm.Icon;
  const statusCls = STATUS_META[status] ?? 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300';

  const visible  = assignees.slice(0, 3);
  const overflow = assignees.length - visible.length;

  return (
    <div
      className="group flex items-center gap-3 px-4 py-2 border-t border-border/40 first:border-t-0 hover:bg-muted/30 transition-colors cursor-pointer"
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('[data-row-action]')) return;
        onOpen();
      }}
    >
      {/* Type chip */}
      <span
        className={cn('inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide shrink-0', tm.classes)}
        aria-label={`Type: ${tm.label}`}
        title={tm.label}
      >
        <TypeIcon className="size-3" />
      </span>

      {/* Issue key */}
      {issueKey && (
        <span className="font-mono text-[11px] text-muted-foreground/80 w-16 shrink-0 truncate">
          {issueKey}
        </span>
      )}

      {/* Title */}
      <span className="text-sm text-foreground truncate flex-1 min-w-0">{title}</span>

      {/* Assignees */}
      {assignees.length > 0 && (
        <div className="flex -space-x-1.5 shrink-0">
          {visible.map((a, i) => {
            const label = a.Name || a.Email || '?';
            return (
              <Avatar key={a.UserId ?? a.Id ?? i} className="size-5 ring-2 ring-card" title={label}>
                {a.AvatarUrl ? <AvatarImage src={a.AvatarUrl} alt={label} className="size-5" /> : null}
                <AvatarFallback className="text-[9px] font-medium">{initials(label)}</AvatarFallback>
              </Avatar>
            );
          })}
          {overflow > 0 && (
            <span
              className="inline-flex size-5 items-center justify-center rounded-full bg-muted text-[9px] font-semibold text-muted-foreground ring-2 ring-card"
              title={assignees.slice(3).map((a) => a.Name || a.Email || '?').join(', ')}
            >
              +{overflow}
            </span>
          )}
        </div>
      )}

      {/* Story points */}
      {points != null && (
        <Badge variant="outline" size="xs" appearance="outline" className="font-mono shrink-0">
          {points}
        </Badge>
      )}

      {/* Status chip */}
      <span className={cn('hidden sm:inline-flex rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide shrink-0', statusCls)}>
        {status}
      </span>

      {/* Priority dot — clicking opens an inline picker. data-row-action stops
          the row's onClick from also opening the drawer. */}
      <DropdownMenu>
        <DropdownMenuTrigger
          data-row-action
          aria-label={`Priority: ${pm.label}. Click to change.`}
          title={`Priority: ${pm.label}`}
          className="shrink-0 rounded-full p-0.5 hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring"
          onClick={(e) => e.stopPropagation()}
        >
          <span className={cn('inline-block size-2 rounded-full', pm.dot)} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" data-row-action onClick={(e) => e.stopPropagation()}>
          {(Object.keys(PRIORITY_META) as (keyof typeof PRIORITY_META)[]).map((p) => {
            const meta = PRIORITY_META[p]!;
            return (
              <DropdownMenuItem key={p} onSelect={() => onPriorityChange(p)}>
                <span className={cn('inline-block size-2 rounded-full', meta.dot)} aria-hidden />
                <span className={p === priority ? 'font-semibold' : ''}>{meta.label}</span>
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Delete */}
      <button
        type="button"
        data-row-action
        onClick={(e) => { e.stopPropagation(); onDelete(); }}
        className="opacity-0 group-hover:opacity-100 rounded-sm p-1 text-muted-foreground transition-opacity hover:bg-destructive/10 hover:text-destructive focus:opacity-100 shrink-0"
        aria-label={`Delete ${title}`}
      >
        <Trash2 className="size-3.5" />
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Inline create
// ─────────────────────────────────────────────────────────────────────────────

function InlineCreate({
  isPending, onCancel, onSubmit,
}: {
  isPending: boolean;
  onCancel: () => void;
  onSubmit: (title: string) => void;
}) {
  const [title, setTitle] = useState('');
  return (
    <div className="px-4 py-2 border-t border-border/40 bg-muted/20">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const v = title.trim();
          if (v) onSubmit(v);
        }}
        className="flex items-center gap-2"
      >
        <Input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape') onCancel(); }}
          placeholder="What needs to be done?"
          className="h-8 text-sm"
        />
        <Button type="submit" size="sm" variant="primary" disabled={!title.trim() || isPending}>
          {isPending ? 'Adding…' : 'Add'}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </form>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Empty
// ─────────────────────────────────────────────────────────────────────────────

function EmptyProjectState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border p-8 text-center">
      <List className="size-10 text-muted-foreground/50" aria-hidden="true" />
      <div className="space-y-1">
        <div className="text-sm font-medium text-foreground">No project to show</div>
        <div className="text-xs text-muted-foreground max-w-sm">
          Create a project in this workspace to start grooming a backlog.
        </div>
      </div>
    </div>
  );
}
