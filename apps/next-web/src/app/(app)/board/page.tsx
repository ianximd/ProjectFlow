'use client';

import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { LayoutGrid, Search, Filter, X } from 'lucide-react';

import { Board } from '@/components/Board';
import type { BoardColumn } from '@/components/Column';
import { TaskDrawer } from '@/components/TaskDrawer';
import { useStore } from '@/store/useStore';
import { notifyApiError } from '@/lib/apiErrorToast';

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

// ── API helpers ──────────────────────────────────────────────────────────────

async function api(path: string, token: string | null, init?: RequestInit) {
  const res = await fetch(`/api/v1${path}`, {
    ...init,
    headers: {
      'Content-Type':  'application/json',
      Authorization:   `Bearer ${token ?? ''}`,
      ...(init?.headers ?? {}),
    },
  });
  // Peek at the body for well-known error codes (e.g. WORKSPACE_FROZEN)
  // without consuming the original stream — callers still .json() the
  // response themselves. clone() is cheap and 204s have no body to peek.
  if (!res.ok && res.status !== 204) {
    res.clone().json().then((json) => notifyApiError(json, res.status)).catch(() => {});
  }
  return res;
}

const TYPE_OPTIONS     = ['EPIC', 'STORY', 'TASK', 'BUG', 'SUBTASK', 'IMPROVEMENT', 'FEATURE', 'TEST'] as const;
const PRIORITY_OPTIONS = ['HIGHEST', 'HIGH', 'MEDIUM', 'LOW', 'LOWEST'] as const;

const FALLBACK_COLUMNS: BoardColumn[] = [
  { id: 'To Do',       title: 'To Do',       category: 'TODO' },
  { id: 'In Progress', title: 'In Progress', category: 'IN_PROGRESS' },
  { id: 'Done',        title: 'Done',        category: 'DONE' },
];

// ── Page ─────────────────────────────────────────────────────────────────────

export default function BoardPage() {
  const queryClient  = useQueryClient();
  const router       = useRouter();
  const accessToken  = useStore((s) => s.accessToken);

  const [selectedTask,    setSelectedTask]    = useState<any | null>(null);
  const currentWorkspaceId  = useStore((s) => s.currentWorkspaceId);
  const currentProjectId    = useStore((s) => s.currentProjectId);
  const setCurrentWorkspace = useStore((s) => s.setCurrentWorkspace);
  const setCurrentProject   = useStore((s) => s.setCurrentProject);
  const [search,          setSearch]          = useState('');
  const [typeFilter,      setTypeFilter]      = useState<string>('ALL');
  const [priorityFilter,  setPriorityFilter]  = useState<string>('ALL');

  // ── Data fetching ─────────────────────────────────────────────────────────

  const { data: workspaces, isLoading: isLoadingWs } = useQuery<any[]>({
    queryKey: ['workspaces', accessToken],
    queryFn: async () => {
      const res = await api('/workspaces', accessToken);
      if (res.status === 401) { router.push('/login'); return []; }
      const json = await res.json();
      const wss = json.data ?? [];
      if (wss.length === 0) router.push('/setup');
      return wss;
    },
  });

  const activeWorkspaceId = currentWorkspaceId ?? workspaces?.[0]?.Id ?? null;

  const { data: projects, isLoading: isLoadingProj } = useQuery<any[]>({
    queryKey: ['projects', activeWorkspaceId, accessToken],
    enabled: !!activeWorkspaceId,
    queryFn: async () => {
      const res = await api(`/projects?workspaceId=${activeWorkspaceId}`, accessToken);
      const json = await res.json();
      return json.data ?? [];
    },
  });

  const activeProjectId = currentProjectId ?? projects?.[0]?.Id ?? null;
  const activeProject   = projects?.find((p: any) => p.Id === activeProjectId) ?? projects?.[0];

  const { data: workflow } = useQuery<{ statuses?: any[] } | null>({
    queryKey: ['workflow', activeProjectId, accessToken],
    enabled: !!activeProjectId,
    queryFn: async () => {
      const res = await api(`/workflows?projectId=${activeProjectId}`, accessToken);
      if (!res.ok) return null;
      const json = await res.json();
      return json.data ?? null;
    },
  });

  const { data: taskList, isLoading: isLoadingTasks } = useQuery<{
    tasks: any[];
    assigneesByTaskId: Record<string, any[]>;
  }>({
    queryKey: ['tasks', activeProjectId, accessToken],
    enabled: !!activeProjectId,
    queryFn: async () => {
      const res = await api(`/tasks?projectId=${activeProjectId}`, accessToken);
      const json = await res.json();
      return {
        tasks: json.data ?? [],
        assigneesByTaskId: json.meta?.assigneesByTaskId ?? {},
      };
    },
  });

  const tasks             = taskList?.tasks;
  const assigneesByTaskId = taskList?.assigneesByTaskId ?? {};

  // Build columns from the workflow (preferred) or fall back to defaults.
  //
  // The /workflows API returns camelCase (workflow.service.ts mapWorkflow),
  // but earlier code read PascalCase (s.Name/Category/Position) which
  // silently produced "col-undefined" columns with empty headers. Accept
  // both cases so a future API-shape drift can't silently break the board.
  const columns: BoardColumn[] = useMemo(() => {
    const ws = workflow?.statuses ?? [];
    if (ws.length === 0) return FALLBACK_COLUMNS;
    return [...ws]
      .sort((a: any, b: any) => (a.position ?? a.Position ?? 0) - (b.position ?? b.Position ?? 0))
      .map((s: any): BoardColumn => {
        const name = s.name ?? s.Name;
        return { id: name, title: name, category: s.category ?? s.Category };
      });
  }, [workflow]);

  // Apply local filters before handing tasks to the board.
  const filteredTasks = useMemo(() => {
    const all = tasks ?? [];
    const q = search.trim().toLowerCase();
    return all.filter((t) => {
      if (typeFilter     !== 'ALL' && (t.Type     ?? t.type)     !== typeFilter)     return false;
      if (priorityFilter !== 'ALL' && (t.Priority ?? t.priority) !== priorityFilter) return false;
      if (q) {
        const hay = `${t.Title ?? t.title ?? ''} ${t.IssueKey ?? t.issueKey ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [tasks, typeFilter, priorityFilter, search]);

  // ── Mutations ─────────────────────────────────────────────────────────────

  // All three mutations need to:
  //  1. Throw on !res.ok so React Query knows the mutation failed.
  //     (`await api(...)` returns a truthy Response even on 4xx/5xx —
  //     without a throw, onSuccess fires regardless and the UI silently
  //     rolls back via the refetch.)
  //  2. Invalidate via onSettled, not onSuccess — so a failed drag still
  //     refetches the canonical positions and the card snaps back to
  //     where the server says it is.
  //
  // The toast comes from notifyApiError inside the api() helper itself.

  // Drag-end persistence: position SP applies status + position in one shot,
  // bypassing the workflow validator (intentional — drag is free-form).
  const reorderTaskMutation = useMutation({
    mutationFn: async (
      { taskId, position, status }: { taskId: string; position: number; status: string | null },
    ) => {
      const res = await api(`/tasks/${taskId}/position`, accessToken, {
        method: 'PATCH',
        body: JSON.stringify(status ? { position, status } : { position }),
      });
      if (!res.ok) throw new Error('reorder failed');
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['tasks', activeProjectId] }),
  });

  const addTaskMutation = useMutation({
    mutationFn: async ({ columnId, content }: { columnId: string; content: string }) => {
      const res = await api(`/tasks`, accessToken, {
        method: 'POST',
        body: JSON.stringify({
          title:       content,
          status:      columnId,
          projectId:   activeProjectId,
          workspaceId: activeWorkspaceId,
        }),
      });
      if (!res.ok) throw new Error('create task failed');
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['tasks', activeProjectId] }),
  });

  const deleteTaskMutation = useMutation({
    mutationFn: async (taskId: string) => {
      const res = await api(`/tasks/${taskId}`, accessToken, { method: 'DELETE' });
      if (!res.ok) throw new Error('delete task failed');
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['tasks', activeProjectId] }),
  });

  // ── Render ────────────────────────────────────────────────────────────────

  const isInitialLoading = isLoadingWs || isLoadingProj || (!!activeProjectId && isLoadingTasks && !tasks);
  const noProject = !activeProjectId && !isLoadingProj && !isLoadingWs;
  const activeFilterCount = (typeFilter !== 'ALL' ? 1 : 0) + (priorityFilter !== 'ALL' ? 1 : 0) + (search.trim() ? 1 : 0);

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

        {/* Switchers */}
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
            <Select
              value={activeProjectId ?? undefined}
              onValueChange={(v) => setCurrentProject(v)}
            >
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

      {/* ── Filter bar ───────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/30 p-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search title or key…"
            className="h-8 pl-7 text-xs"
            aria-label="Filter tasks by title or issue key"
          />
        </div>

        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="h-8 w-[130px] text-xs"><SelectValue placeholder="Type" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All types</SelectItem>
            {TYPE_OPTIONS.map((t) => <SelectItem key={t} value={t}>{t.charAt(0) + t.slice(1).toLowerCase()}</SelectItem>)}
          </SelectContent>
        </Select>

        <Select value={priorityFilter} onValueChange={setPriorityFilter}>
          <SelectTrigger className="h-8 w-[140px] text-xs"><SelectValue placeholder="Priority" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All priorities</SelectItem>
            {PRIORITY_OPTIONS.map((p) => <SelectItem key={p} value={p}>{p.charAt(0) + p.slice(1).toLowerCase()}</SelectItem>)}
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
          {tasks
            ? <>Showing <strong className="text-foreground">{filteredTasks.length}</strong> of <strong className="text-foreground">{tasks.length}</strong></>
            : ' '}
        </div>
      </div>

      {/* ── Body ─────────────────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0">
        {isInitialLoading ? (
          <BoardSkeleton />
        ) : noProject ? (
          <EmptyProjectState />
        ) : (
          <Board
            columns={columns}
            initialTasks={filteredTasks}
            assigneesByTaskId={assigneesByTaskId}
            onReorderTask={(taskId, position, status) =>
              reorderTaskMutation.mutate({ taskId, position, status })
            }
            onAddTask={(columnId, content) => addTaskMutation.mutate({ columnId, content })}
            onDeleteTask={(taskId) => deleteTaskMutation.mutate(taskId)}
            onOpenTask={(task) => setSelectedTask(task)}
          />
        )}
      </div>

      <TaskDrawer task={selectedTask} onClose={() => setSelectedTask(null)} />
    </div>
  );
}

// ── Sub-components ───────────────────────────────────────────────────────────

function BoardSkeleton() {
  return (
    <div className="flex h-full gap-3 overflow-hidden">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="flex w-[300px] min-w-[300px] flex-col gap-2 rounded-xl border border-border bg-muted/40 p-2"
        >
          <Skeleton className="h-4 w-24" />
          {[0, 1, 2].map((j) => (
            <Skeleton key={j} className="h-20 w-full rounded-lg" />
          ))}
        </div>
      ))}
    </div>
  );
}

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
