'use client';

import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import {
  List, Search, Filter, X, Plus, Trash2,
  Bug, Bookmark, CheckSquare, Award, GitBranch, Sparkles, Zap, FlaskConical,
  Calendar, ChevronDown, ChevronRight,
} from 'lucide-react';

import { useStore } from '@/store/useStore';
import { notifyApiError } from '@/lib/apiErrorToast';
import { TaskDrawer } from '@/components/TaskDrawer';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Card } from '@/components/ui/card';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

// ── Types ────────────────────────────────────────────────────────────────────

type ApiTask  = Record<string, any>;
type ApiSprint = {
  Id: string; Name: string; Status: string;
  StartDate: string | null; EndDate: string | null; Goal: string | null;
};

interface AssigneeRow {
  TaskId:    string;
  UserId:    string;
  Email:     string;
  Name:      string;
  AvatarUrl: string | null;
}

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
  // Workflow status badges. We don't know every workflow's statuses up front,
  // so we map a few well-known ones and fall back to a neutral chip.
  'To Do':       'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  'In Progress': 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300',
  'Done':        'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
  'Blocked':     'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300',
};

// ── Field accessors (defensive against PascalCase/camelCase) ─────────────────

const get = (t: ApiTask, ...keys: string[]) => {
  for (const k of keys) if (t[k] != null) return t[k];
  return undefined;
};

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

// ── API helper ───────────────────────────────────────────────────────────────

async function api(path: string, token: string | null, init?: RequestInit) {
  const res = await fetch(`/api/v1${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization:  `Bearer ${token ?? ''}`,
      ...(init?.headers ?? {}),
    },
  });
  if (res.status === 204) return {};
  const json = await res.json().catch(() => ({}));
  if (!res.ok) notifyApiError(json, res.status);
  return { ok: res.ok, status: res.status, json };
}

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────

export default function BacklogPage() {
  const router      = useRouter();
  const qc          = useQueryClient();
  const accessToken = useStore((s) => s.accessToken);

  const currentWorkspaceId  = useStore((s) => s.currentWorkspaceId);
  const currentProjectId    = useStore((s) => s.currentProjectId);
  const setCurrentWorkspace = useStore((s) => s.setCurrentWorkspace);
  const setCurrentProject   = useStore((s) => s.setCurrentProject);
  const [search,      setSearch]      = useState('');
  const [typeFilter,  setTypeFilter]  = useState<string>('ALL');
  const [priorityFilter, setPriorityFilter] = useState<string>('ALL');
  const [selectedTask, setSelectedTask] = useState<ApiTask | null>(null);
  const [collapsed,    setCollapsed]    = useState<Record<string, boolean>>({});
  const [creatingFor,  setCreatingFor]  = useState<string | null>(null);  // sprintId or "BACKLOG"

  // ── Workspace / project queries ────────────────────────────────────────────
  const { data: workspaces, isLoading: isLoadingWs } = useQuery<any[]>({
    queryKey: ['workspaces', accessToken],
    queryFn: async () => {
      const { ok, status, json } = await api('/workspaces', accessToken) as any;
      if (status === 401) { router.push('/login'); return []; }
      const wss = ok ? (json.data ?? []) : [];
      if (wss.length === 0) router.push('/setup');
      return wss;
    },
  });
  const activeWorkspaceId = currentWorkspaceId ?? workspaces?.[0]?.Id ?? null;

  const { data: projects, isLoading: isLoadingProj } = useQuery<any[]>({
    queryKey: ['projects', activeWorkspaceId, accessToken],
    enabled: !!activeWorkspaceId,
    queryFn: async () => {
      const { ok, json } = await api(`/projects?workspaceId=${activeWorkspaceId}`, accessToken) as any;
      return ok ? (json.data ?? []) : [];
    },
  });
  const activeProjectId = currentProjectId ?? projects?.[0]?.Id ?? null;
  const activeProject   = projects?.find((p: any) => p.Id === activeProjectId) ?? projects?.[0];

  // ── Tasks + sprints ────────────────────────────────────────────────────────
  const { data: taskList, isLoading: isLoadingTasks } = useQuery<{
    tasks: ApiTask[];
    assigneesByTaskId: Record<string, AssigneeRow[]>;
  }>({
    queryKey: ['backlog-tasks', activeProjectId, accessToken],
    enabled: !!activeProjectId,
    queryFn: async () => {
      // Pull a generous page so the backlog renders in one shot. Real-world
      // projects with > 200 backlog issues are rare; if it becomes a problem
      // we can add infinite-scroll then.
      const { ok, json } = await api(
        `/tasks?projectId=${activeProjectId}&pageSize=200`, accessToken,
      ) as any;
      return {
        tasks:             ok ? (json.data ?? []) : [],
        assigneesByTaskId: json?.meta?.assigneesByTaskId ?? {},
      };
    },
  });

  const { data: sprints } = useQuery<ApiSprint[]>({
    queryKey: ['sprints', activeProjectId, accessToken],
    enabled: !!activeProjectId,
    queryFn: async () => {
      const { ok, json } = await api(`/sprints?projectId=${activeProjectId}`, accessToken) as any;
      return ok ? (json.data ?? []) : [];
    },
  });

  const tasks             = taskList?.tasks ?? [];
  const assigneesByTaskId = taskList?.assigneesByTaskId ?? {};

  // ── Local filter pipeline ──────────────────────────────────────────────────
  const filteredTasks = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tasks.filter((t) => {
      if (typeFilter     !== 'ALL' && (get(t, 'Type', 'type'))         !== typeFilter)     return false;
      if (priorityFilter !== 'ALL' && (get(t, 'Priority', 'priority')) !== priorityFilter) return false;
      if (q) {
        const hay = `${get(t, 'Title', 'title') ?? ''} ${get(t, 'IssueKey', 'issueKey') ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [tasks, typeFilter, priorityFilter, search]);

  // ── Group tasks by section: ACTIVE sprints, PLANNED sprints, then Backlog
  // (no SprintId). COMPLETED sprints are deliberately hidden — the historical
  // view lives on the dashboard.
  const sections = useMemo(() => {
    const visibleSprints = (sprints ?? [])
      .filter((s) => s.Status !== 'COMPLETED')
      .sort((a, b) => {
        // Active first, then planned by start date.
        if (a.Status !== b.Status) return a.Status === 'ACTIVE' ? -1 : 1;
        const da = a.StartDate ? new Date(a.StartDate).getTime() : Number.MAX_SAFE_INTEGER;
        const db = b.StartDate ? new Date(b.StartDate).getTime() : Number.MAX_SAFE_INTEGER;
        return da - db;
      });

    const bySprint: Record<string, ApiTask[]> = {};
    const backlog: ApiTask[] = [];
    for (const t of filteredTasks) {
      const sid = get(t, 'SprintId', 'sprintId');
      if (sid) (bySprint[sid] ?? (bySprint[sid] = [])).push(t);
      else     backlog.push(t);
    }

    const sprintSections = visibleSprints.map((s) => ({
      key:    s.Id,
      kind:   'SPRINT' as const,
      sprint: s,
      title:  s.Name,
      tasks:  bySprint[s.Id] ?? [],
    }));

    return [
      ...sprintSections,
      { key: 'BACKLOG', kind: 'BACKLOG' as const, sprint: null, title: 'Backlog', tasks: backlog },
    ];
  }, [filteredTasks, sprints]);

  // ── Mutations ──────────────────────────────────────────────────────────────
  const createMutation = useMutation({
    mutationFn: async ({ title, sprintId }: { title: string; sprintId: string | null }) => {
      const body: Record<string, unknown> = {
        title,
        projectId:   activeProjectId,
        workspaceId: activeWorkspaceId,
      };
      if (sprintId) body.sprintId = sprintId;
      const { ok, json } = await api('/tasks', accessToken, {
        method: 'POST', body: JSON.stringify(body),
      }) as any;
      if (!ok) throw new Error(json?.error?.message ?? 'Create failed');
      return json.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['backlog-tasks', activeProjectId] });
      setCreatingFor(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (taskId: string) => {
      const { ok } = await api(`/tasks/${taskId}`, accessToken, { method: 'DELETE' }) as any;
      if (!ok) throw new Error('Delete failed');
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['backlog-tasks', activeProjectId] }),
  });

  const priorityMutation = useMutation({
    mutationFn: async ({ taskId, priority }: { taskId: string; priority: string }) => {
      const { ok } = await api(`/tasks/${taskId}`, accessToken, {
        method: 'PATCH',
        body:   JSON.stringify({ priority }),
      }) as any;
      if (!ok) throw new Error('Priority update failed');
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['backlog-tasks', activeProjectId] });
      qc.invalidateQueries({ queryKey: ['tasks'] });
    },
  });

  // ── Derived UI state ───────────────────────────────────────────────────────
  const isInitialLoading = isLoadingWs || isLoadingProj || (!!activeProjectId && isLoadingTasks && !taskList);
  const noProject = !activeProjectId && !isLoadingProj && !isLoadingWs;
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
              {activeProject?.Key && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono">{activeProject.Key}</span>
                </>
              )}
            </div>
            <h2 className="text-base font-semibold text-foreground truncate">
              {activeProject?.Name ?? (isLoadingProj ? 'Loading…' : 'No project')}
            </h2>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {workspaces && workspaces.length > 1 && (
            <Select
              value={activeWorkspaceId ?? undefined}
              onValueChange={(v) => setCurrentWorkspace(v)}
            >
              <SelectTrigger className="h-8 w-[180px] text-xs">
                <SelectValue placeholder="Workspace" />
              </SelectTrigger>
              <SelectContent>
                {workspaces.map((ws: any) => (
                  <SelectItem key={ws.Id} value={ws.Id}>{ws.Name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {projects && projects.length > 1 && (
            <Select value={activeProjectId ?? undefined} onValueChange={(v) => setCurrentProject(v)}>
              <SelectTrigger className="h-8 w-[200px] text-xs">
                <SelectValue placeholder="Project" />
              </SelectTrigger>
              <SelectContent>
                {projects.map((p: any) => (
                  <SelectItem key={p.Id} value={p.Id}>
                    <span className="font-mono mr-2 text-muted-foreground">{p.Key}</span>
                    {p.Name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>

      {/* ── Filter bar ─────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/30 p-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search title or key…"
            className="h-8 pl-7 text-xs"
            aria-label="Filter backlog by title or issue key"
          />
        </div>

        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="h-8 w-[130px] text-xs"><SelectValue placeholder="Type" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All types</SelectItem>
            {TYPE_OPTIONS.map((t) => <SelectItem key={t} value={t}>{TYPE_META[t]?.label ?? t}</SelectItem>)}
          </SelectContent>
        </Select>

        <Select value={priorityFilter} onValueChange={setPriorityFilter}>
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
              onClick={() => { setSearch(''); setTypeFilter('ALL'); setPriorityFilter('ALL'); }}
              className="h-8 px-2 text-xs"
            >
              <X className="size-3.5" /> Clear
            </Button>
          </>
        )}

        <div className="ml-auto text-xs text-muted-foreground">
          Showing <strong className="text-foreground">{filteredTasks.length}</strong> of <strong className="text-foreground">{tasks.length}</strong>
        </div>
      </div>

      {/* ── Body ───────────────────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {isInitialLoading ? (
          <BacklogSkeleton />
        ) : noProject ? (
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
                onStartCreate={() => setCreatingFor(s.kind === 'BACKLOG' ? 'BACKLOG' : s.sprint!.Id)}
                onCancelCreate={() => setCreatingFor(null)}
                onSubmitCreate={(title) =>
                  createMutation.mutate({
                    title,
                    sprintId: s.kind === 'SPRINT' ? s.sprint!.Id : null,
                  })
                }
                isCreating={createMutation.isPending}
                onOpenTask={setSelectedTask}
                onDeleteTask={(id) => {
                  if (window.confirm('Delete this issue?')) deleteMutation.mutate(id);
                }}
                onPriorityChange={(id, p) => priorityMutation.mutate({ taskId: id, priority: p })}
              />
            ))}
          </div>
        )}
      </div>

      <TaskDrawer task={selectedTask} onClose={() => setSelectedTask(null)} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Section (sprint or backlog)
// ─────────────────────────────────────────────────────────────────────────────

type SectionData =
  | { key: string; kind: 'SPRINT';  sprint: ApiSprint; title: string; tasks: ApiTask[] }
  | { key: string; kind: 'BACKLOG'; sprint: null;       title: string; tasks: ApiTask[] };

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
  onOpenTask: (t: ApiTask) => void;
  onDeleteTask: (id: string) => void;
  onPriorityChange: (id: string, priority: string) => void;
}) {
  const totalPoints = section.tasks.reduce(
    (acc, t) => acc + (Number(get(t, 'StoryPoints', 'storyPoints')) || 0),
    0,
  );
  const isCreatingHere = creatingFor === section.key
    || (section.kind === 'SPRINT' && creatingFor === section.sprint!.Id)
    || (section.kind === 'BACKLOG' && creatingFor === 'BACKLOG');

  return (
    <Card className="overflow-hidden">
      {/* ── Section header ─────────────────────────────────────────────────── */}
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

          {section.kind === 'SPRINT' && (
            <SprintMeta sprint={section.sprint} />
          )}

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

      {/* ── Section body ───────────────────────────────────────────────────── */}
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
              key={String(get(t, 'Id', 'id'))}
              task={t}
              assignees={assigneesByTaskId[String(get(t, 'Id', 'id'))] ?? []}
              onOpen={() => onOpenTask(t)}
              onDelete={() => onDeleteTask(String(get(t, 'Id', 'id')))}
              onPriorityChange={(p) => onPriorityChange(String(get(t, 'Id', 'id')), p)}
            />
          ))}

          {isCreatingHere && (
            <InlineCreate
              isPending={isCreating}
              onCancel={onCancelCreate}
              onSubmit={onSubmitCreate}
            />
          )}
        </div>
      )}
    </Card>
  );
}

function SprintMeta({ sprint }: { sprint: ApiSprint }) {
  const cls = sprint.Status === 'ACTIVE'
    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
    : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300';
  return (
    <>
      <span className={cn('inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide', cls)}>
        {sprint.Status === 'ACTIVE' ? 'Active' : 'Planned'}
      </span>
      {(sprint.StartDate || sprint.EndDate) && (
        <span className="hidden md:inline-flex items-center gap-1 text-xs text-muted-foreground">
          <Calendar className="size-3" />
          {sprint.StartDate?.slice(0, 10) ?? '?'} → {sprint.EndDate?.slice(0, 10) ?? '?'}
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
  task: ApiTask;
  assignees: AssigneeRow[];
  onOpen: () => void;
  onDelete: () => void;
  onPriorityChange: (priority: string) => void;
}) {
  const type     = String(get(task, 'Type', 'type') ?? 'TASK').toUpperCase();
  const priority = String(get(task, 'Priority', 'priority') ?? 'MEDIUM').toUpperCase();
  const status   = String(get(task, 'Status', 'status') ?? 'To Do');
  const title    = get(task, 'Title', 'title') ?? '(untitled)';
  const issueKey = get(task, 'IssueKey', 'issueKey');
  const points   = get(task, 'StoryPoints', 'storyPoints');

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
      <span className="text-sm text-foreground truncate flex-1 min-w-0">
        {title}
      </span>

      {/* Assignees */}
      {assignees.length > 0 && (
        <div className="flex -space-x-1.5 shrink-0">
          {visible.map((a) => (
            <Avatar key={a.UserId} className="size-5 ring-2 ring-card" title={a.Name || a.Email}>
              {a.AvatarUrl ? <AvatarImage src={a.AvatarUrl} alt={a.Name} className="size-5" /> : null}
              <AvatarFallback className="text-[9px] font-medium">
                {initials(a.Name || a.Email)}
              </AvatarFallback>
            </Avatar>
          ))}
          {overflow > 0 && (
            <span
              className="inline-flex size-5 items-center justify-center rounded-full bg-muted text-[9px] font-semibold text-muted-foreground ring-2 ring-card"
              title={assignees.slice(3).map((a) => a.Name).join(', ')}
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
// Empty / loading
// ─────────────────────────────────────────────────────────────────────────────

function BacklogSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      {[0, 1, 2].map((i) => (
        <Card key={i} className="p-4 flex flex-col gap-2">
          <Skeleton className="h-5 w-40" />
          {[0, 1].map((j) => <Skeleton key={j} className="h-7 w-full" />)}
        </Card>
      ))}
    </div>
  );
}

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
