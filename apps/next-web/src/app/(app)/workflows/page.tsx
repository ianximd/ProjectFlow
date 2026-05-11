'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Workflow, Plus, Edit3, Check, X, Trash2, MoveRight, ArrowRight,
  Circle, Loader2, CheckCircle2,
} from 'lucide-react';

import { useStore } from '@/store/useStore';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody, DialogFooter,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

// ── Types ────────────────────────────────────────────────────────────────────

interface WorkflowStatus {
  id:       string;
  name:     string;
  category: string;
  color:    string;
  position: number;
}

interface WorkflowTransition {
  id:         string;
  fromStatus: string;
  toStatus:   string;
  name:       string | null;
}

interface WorkflowData {
  id:          string;
  name:        string;
  statuses:    WorkflowStatus[];
  transitions: WorkflowTransition[];
}

// ── Category meta ────────────────────────────────────────────────────────────

type Category = 'TODO' | 'IN_PROGRESS' | 'DONE';
const CATEGORY_ORDER: Category[] = ['TODO', 'IN_PROGRESS', 'DONE'];
const CATEGORY_META: Record<Category, {
  label:    string;
  icon:     typeof Circle;
  cls:      string;        // chip background
  iconCls:  string;        // header icon tint
  defaultColor: string;
}> = {
  TODO:        { label: 'To Do',       icon: Circle,        cls: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',         iconCls: 'text-slate-500',  defaultColor: '#94a3b8' },
  IN_PROGRESS: { label: 'In Progress', icon: Loader2,       cls: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300',             iconCls: 'text-blue-500',   defaultColor: '#3b82f6' },
  DONE:        { label: 'Done',        icon: CheckCircle2,  cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300', iconCls: 'text-emerald-500', defaultColor: '#10b981' },
};

const TEMPLATES = [
  { value: 'DEFAULT', label: 'Default (To Do → In Progress → Done)' },
  { value: 'BUG',     label: 'Bug workflow (extra states for triage)' },
  { value: 'AGILE',   label: 'Agile (with review & testing)' },
];

// ── API helper ───────────────────────────────────────────────────────────────

async function api(path: string, token: string | null, init?: RequestInit) {
  const res = await fetch(`/api/v1${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization:  `Bearer ${token ?? ''}`,
      ...(init?.headers ?? {}),
    },
    credentials: 'include',
  });
  if (res.status === 204) return { ok: res.ok, status: res.status, json: {} };
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, json };
}

// ─────────────────────────────────────────────────────────────────────────────

export default function WorkflowsPage() {
  const router      = useRouter();
  const accessToken = useStore((s) => s.accessToken);

  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [projectId,   setProjectId]   = useState<string | null>(null);

  // ── Workspace / project ────────────────────────────────────────────────────
  const { data: workspaces, isLoading: isLoadingWs } = useQuery<any[]>({
    queryKey: ['workspaces', accessToken],
    queryFn: async () => {
      const { status, ok, json } = await api('/workspaces', accessToken);
      if (status === 401) { router.push('/login'); return []; }
      const wss = ok ? (json.data ?? []) : [];
      if (wss.length === 0) router.push('/setup');
      return wss;
    },
  });
  const activeWorkspaceId = workspaceId ?? workspaces?.[0]?.Id ?? null;

  const { data: projects, isLoading: isLoadingProj } = useQuery<any[]>({
    queryKey: ['projects', activeWorkspaceId, accessToken],
    enabled: !!activeWorkspaceId,
    queryFn: async () => {
      const { ok, json } = await api(`/projects?workspaceId=${activeWorkspaceId}`, accessToken);
      return ok ? (json.data ?? []) : [];
    },
  });
  const activeProjectId = projectId ?? projects?.[0]?.Id ?? null;
  const activeProject   = projects?.find((p: any) => p.Id === activeProjectId) ?? projects?.[0];

  // ── Workflow ───────────────────────────────────────────────────────────────
  const { data: workflow, isLoading: isLoadingWf } = useQuery<WorkflowData | null>({
    queryKey: ['workflow', activeProjectId, accessToken],
    enabled: !!activeProjectId,
    queryFn: async () => {
      const { ok, json } = await api(`/workflows?projectId=${activeProjectId}`, accessToken);
      return ok ? (json.data ?? null) : null;
    },
  });

  const isInitialLoading = isLoadingWs || isLoadingProj || (!!activeProjectId && isLoadingWf && !workflow);
  const noProject = !activeProjectId && !isLoadingProj && !isLoadingWs;

  return (
    <div className="flex h-full flex-col gap-4">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <div className="rounded-lg bg-primary/10 p-2 text-primary">
            <Workflow className="size-5" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>Workflows</span>
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
              onValueChange={(v) => { setWorkspaceId(v); setProjectId(null); }}
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
            <Select value={activeProjectId ?? undefined} onValueChange={(v) => setProjectId(v)}>
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

      {isInitialLoading ? (
        <WorkflowSkeleton />
      ) : noProject ? (
        <EmptyProjectState />
      ) : !workflow ? (
        <CreateWorkflowPanel projectId={activeProjectId!} />
      ) : (
        <WorkflowEditor projectId={activeProjectId!} workflow={workflow} />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Create workflow panel (shown when project has no workflow yet)
// ─────────────────────────────────────────────────────────────────────────────

function CreateWorkflowPanel({ projectId }: { projectId: string }) {
  const accessToken = useStore((s) => s.accessToken);
  const qc          = useQueryClient();

  const [name,     setName]     = useState('Default workflow');
  const [template, setTemplate] = useState('DEFAULT');

  const createMutation = useMutation({
    mutationFn: async () => {
      const { ok, json } = await api('/workflows', accessToken, {
        method: 'POST', body: JSON.stringify({ projectId, name, template }),
      });
      if (!ok) throw new Error(json?.error ?? 'Create failed');
      return json.data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['workflow', projectId] }),
  });

  return (
    <Card className="p-6 max-w-2xl">
      <div className="flex items-start gap-3">
        <div className="rounded-lg bg-primary/10 p-2 text-primary shrink-0">
          <Workflow className="size-5" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-foreground">No workflow yet</h3>
          <p className="text-xs text-muted-foreground mt-1">
            A workflow defines the statuses your issues can move through and the transitions
            between them. Start from a template — you can customise it later.
          </p>
        </div>
      </div>

      <div className="mt-5 flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="wf-name" className="text-xs font-medium text-muted-foreground">Name</label>
          <Input
            id="wf-name" value={name} onChange={(e) => setName(e.target.value)} required
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="wf-template" className="text-xs font-medium text-muted-foreground">Template</label>
          <Select value={template} onValueChange={setTemplate}>
            <SelectTrigger id="wf-template" className="h-9 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              {TEMPLATES.map((t) => (
                <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {createMutation.error && (
          <div className="rounded-md border-l-2 border-destructive bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {(createMutation.error as Error).message}
          </div>
        )}
        <div className="flex justify-end">
          <Button
            variant="primary"
            disabled={!name.trim() || createMutation.isPending}
            onClick={() => createMutation.mutate()}
          >
            {createMutation.isPending ? 'Creating…' : 'Create workflow'}
          </Button>
        </div>
      </div>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Editor (statuses + transitions, two cards)
// ─────────────────────────────────────────────────────────────────────────────

function WorkflowEditor({ projectId, workflow }: { projectId: string; workflow: WorkflowData }) {
  const accessToken = useStore((s) => s.accessToken);
  const qc          = useQueryClient();

  const invalidate = () => qc.invalidateQueries({ queryKey: ['workflow', projectId] });

  const addStatusMutation = useMutation({
    mutationFn: async (input: { name: string; category: string; color: string }) => {
      const { ok, json } = await api(`/workflows/${workflow.id}/statuses`, accessToken, {
        method: 'POST', body: JSON.stringify(input),
      });
      if (!ok) throw new Error(json?.error ?? 'Add failed');
      return json.data;
    },
    onSuccess: invalidate,
  });

  const updateStatusMutation = useMutation({
    mutationFn: async ({ statusId, patch }: { statusId: string; patch: Record<string, unknown> }) => {
      const { ok, json } = await api(`/workflows/statuses/${statusId}`, accessToken, {
        method: 'PATCH', body: JSON.stringify(patch),
      });
      if (!ok) throw new Error(json?.error ?? 'Update failed');
      return json.data;
    },
    onSuccess: invalidate,
  });

  const deleteStatusMutation = useMutation({
    mutationFn: async (statusId: string) => {
      const { ok, json } = await api(`/workflows/statuses/${statusId}`, accessToken, { method: 'DELETE' });
      if (!ok) throw new Error(json?.error ?? 'Delete failed');
    },
    onSuccess: invalidate,
    onError:   (err: any) => window.alert(err.message),
  });

  const addTransitionMutation = useMutation({
    mutationFn: async (input: { from: string; to: string }) => {
      const { ok, json } = await api(`/workflows/${workflow.id}/transitions`, accessToken, {
        method: 'POST',
        body: JSON.stringify({ fromStatus: input.from, toStatus: input.to }),
      });
      if (!ok) throw new Error(json?.error ?? 'Add failed');
      return json.data;
    },
    onSuccess: invalidate,
    onError:   (err: any) => window.alert(err.message),
  });

  const removeTransitionMutation = useMutation({
    mutationFn: async ({ from, to }: { from: string; to: string }) => {
      const { ok } = await api(`/workflows/${workflow.id}/transitions`, accessToken, {
        method: 'DELETE',
        body: JSON.stringify({ fromStatus: from, toStatus: to }),
      });
      if (!ok) throw new Error('Remove failed');
    },
    onSuccess: invalidate,
  });

  // Group by category for the statuses card
  const byCategory = useMemo(() => {
    const buckets: Record<Category, WorkflowStatus[]> = {
      TODO: [], IN_PROGRESS: [], DONE: [],
    };
    for (const s of workflow.statuses) {
      const cat = (CATEGORY_ORDER as string[]).includes(s.category)
        ? (s.category as Category)
        : 'TODO';
      buckets[cat].push(s);
    }
    for (const cat of CATEGORY_ORDER) {
      buckets[cat].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
    }
    return buckets;
  }, [workflow.statuses]);

  const [addStatusOpen, setAddStatusOpen] = useState(false);

  const statusNames = workflow.statuses.map((s) => s.name);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 flex-1 min-h-0">
      {/* ── Statuses card ─────────────────────────────────────────────────── */}
      <Card className="p-0 overflow-hidden flex flex-col min-h-0">
        <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-border/60">
          <div className="flex items-center gap-2 min-w-0">
            <Circle className="size-4 text-muted-foreground" aria-hidden="true" />
            <h3 className="text-sm font-semibold text-foreground">Statuses</h3>
            <Badge variant="outline" size="xs" appearance="outline" className="font-normal">
              {workflow.statuses.length}
            </Badge>
          </div>
          <Button size="sm" variant="primary" onClick={() => setAddStatusOpen(true)}>
            <Plus className="size-3.5" /> Add status
          </Button>
        </div>

        <div className="p-4 flex-1 min-h-0 overflow-y-auto flex flex-col gap-4">
          {CATEGORY_ORDER.map((cat) => (
            <CategoryGroup
              key={cat}
              category={cat}
              statuses={byCategory[cat]}
              busy={updateStatusMutation.isPending || deleteStatusMutation.isPending}
              onRename={(id, name) => updateStatusMutation.mutate({ statusId: id, patch: { name } })}
              onRecolor={(id, color) => updateStatusMutation.mutate({ statusId: id, patch: { color } })}
              onCategory={(id, category) => updateStatusMutation.mutate({ statusId: id, patch: { category } })}
              onDelete={(id, name) => {
                if (window.confirm(`Delete status "${name}"?\n\nThis will fail if any open issues are still in this status.`)) {
                  deleteStatusMutation.mutate(id);
                }
              }}
            />
          ))}
        </div>
      </Card>

      {/* ── Transitions card ──────────────────────────────────────────────── */}
      <Card className="p-0 overflow-hidden flex flex-col min-h-0">
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border/60">
          <MoveRight className="size-4 text-muted-foreground" aria-hidden="true" />
          <h3 className="text-sm font-semibold text-foreground">Transitions</h3>
          <Badge variant="outline" size="xs" appearance="outline" className="font-normal">
            {workflow.transitions.length}
          </Badge>
          <span className="ml-auto text-xs text-muted-foreground">
            Defines which status changes are allowed
          </span>
        </div>

        <div className="p-4 flex-1 min-h-0 overflow-y-auto flex flex-col gap-3">
          {workflow.transitions.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
              No transitions defined yet. Issues can't change status until you add at least one transition below.
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              {workflow.transitions.map((t) => (
                <div
                  key={t.id}
                  className="flex items-center gap-2 rounded-md border border-border/60 bg-muted/20 px-3 py-2"
                >
                  <StatusPill name={t.fromStatus} statuses={workflow.statuses} />
                  <ArrowRight className="size-3.5 text-muted-foreground shrink-0" />
                  <StatusPill name={t.toStatus} statuses={workflow.statuses} />
                  {t.name && (
                    <span className="text-xs text-muted-foreground truncate">({t.name})</span>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="ml-auto h-7 px-2 text-destructive hover:text-destructive"
                    onClick={() => removeTransitionMutation.mutate({ from: t.fromStatus, to: t.toStatus })}
                    aria-label={`Remove transition ${t.fromStatus} to ${t.toStatus}`}
                    disabled={removeTransitionMutation.isPending}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          {/* Add transition inline form */}
          <AddTransitionForm
            statusNames={statusNames}
            onSubmit={(from, to) => addTransitionMutation.mutate({ from, to })}
            isPending={addTransitionMutation.isPending}
          />
        </div>
      </Card>

      <AddStatusDialog
        open={addStatusOpen}
        onClose={() => setAddStatusOpen(false)}
        onSubmit={(input) =>
          addStatusMutation.mutate(input, { onSuccess: () => setAddStatusOpen(false) })
        }
        isPending={addStatusMutation.isPending}
        error={(addStatusMutation.error as Error | null)?.message ?? null}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

function CategoryGroup({
  category, statuses, busy,
  onRename, onRecolor, onCategory, onDelete,
}: {
  category: Category;
  statuses: WorkflowStatus[];
  busy: boolean;
  onRename:   (id: string, name: string) => void;
  onRecolor:  (id: string, color: string) => void;
  onCategory: (id: string, category: Category) => void;
  onDelete:   (id: string, name: string) => void;
}) {
  const meta = CATEGORY_META[category];
  const Icon = meta.icon;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <Icon className={cn('size-4', meta.iconCls)} aria-hidden="true" />
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {meta.label}
        </h4>
        <Badge variant="outline" size="xs" appearance="outline" className="font-normal">
          {statuses.length}
        </Badge>
      </div>
      {statuses.length === 0 ? (
        <div className="text-xs text-muted-foreground/70 italic pl-6">
          No statuses in this category.
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {statuses.map((s) => (
            <StatusRow
              key={s.id}
              status={s}
              busy={busy}
              onRename={(name) => onRename(s.id, name)}
              onRecolor={(color) => onRecolor(s.id, color)}
              onCategory={(c) => onCategory(s.id, c)}
              onDelete={() => onDelete(s.id, s.name)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function StatusRow({
  status, busy, onRename, onRecolor, onCategory, onDelete,
}: {
  status: WorkflowStatus;
  busy: boolean;
  onRename: (name: string) => void;
  onRecolor: (color: string) => void;
  onCategory: (category: Category) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(status.name);

  const commit = () => {
    const v = draftName.trim();
    if (v && v !== status.name) onRename(v);
    setEditing(false);
  };

  return (
    <div className="group flex items-center gap-2 rounded-md border border-border/60 bg-muted/20 px-3 py-1.5">
      {/* Colour swatch doubles as a color picker — click anywhere to change. */}
      <label
        className="relative inline-flex size-5 rounded-full shrink-0 cursor-pointer ring-2 ring-card"
        style={{ background: status.color }}
        title="Change colour"
      >
        <input
          type="color"
          value={status.color}
          onChange={(e) => onRecolor(e.target.value)}
          className="absolute inset-0 size-full opacity-0 cursor-pointer"
          aria-label={`Change colour for ${status.name}`}
        />
      </label>

      {editing ? (
        <Input
          value={draftName}
          autoFocus
          onChange={(e) => setDraftName(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') { setDraftName(status.name); setEditing(false); }
          }}
          className="h-7 text-sm flex-1 min-w-0"
        />
      ) : (
        <span
          className="text-sm text-foreground truncate flex-1 min-w-0 cursor-text"
          onDoubleClick={() => { setDraftName(status.name); setEditing(true); }}
          title="Double-click to rename"
        >
          {status.name}
        </span>
      )}

      <Select
        value={status.category}
        onValueChange={(v) => onCategory(v as Category)}
        disabled={busy}
      >
        <SelectTrigger className="h-7 w-[130px] text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {CATEGORY_ORDER.map((c) => (
            <SelectItem key={c} value={c}>{CATEGORY_META[c].label}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
        {editing ? (
          <Button size="sm" variant="ghost" onClick={commit} className="h-7 w-7 p-0" aria-label="Save">
            <Check className="size-3.5" />
          </Button>
        ) : (
          <Button
            size="sm" variant="ghost" className="h-7 w-7 p-0"
            onClick={() => { setDraftName(status.name); setEditing(true); }}
            aria-label="Rename"
          >
            <Edit3 className="size-3.5" />
          </Button>
        )}
        <Button
          size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive hover:text-destructive"
          onClick={onDelete}
          aria-label={`Delete ${status.name}`}
          disabled={busy}
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}

function StatusPill({ name, statuses }: { name: string; statuses: WorkflowStatus[] }) {
  const s = statuses.find((x) => x.name === name);
  const color = s?.color ?? '#94a3b8';
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-card border border-border/60 px-2 py-0.5 text-xs font-medium text-foreground shrink-0">
      <span className="inline-block size-2 rounded-full" style={{ background: color }} />
      {name}
    </span>
  );
}

function AddTransitionForm({
  statusNames, onSubmit, isPending,
}: {
  statusNames: string[];
  onSubmit: (from: string, to: string) => void;
  isPending: boolean;
}) {
  const [from, setFrom] = useState<string>('');
  const [to,   setTo]   = useState<string>('');
  const canSubmit = !!from && !!to && from !== to && !isPending;

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-dashed border-border bg-muted/30 p-2">
      <Select value={from} onValueChange={setFrom}>
        <SelectTrigger className="h-8 w-[160px] text-xs">
          <SelectValue placeholder="From status…" />
        </SelectTrigger>
        <SelectContent>
          {statusNames.map((n) => <SelectItem key={n} value={n}>{n}</SelectItem>)}
        </SelectContent>
      </Select>
      <ArrowRight className="size-3.5 text-muted-foreground" />
      <Select value={to} onValueChange={setTo}>
        <SelectTrigger className="h-8 w-[160px] text-xs">
          <SelectValue placeholder="To status…" />
        </SelectTrigger>
        <SelectContent>
          {statusNames.filter((n) => n !== from).map((n) => (
            <SelectItem key={n} value={n}>{n}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        size="sm"
        variant="primary"
        disabled={!canSubmit}
        onClick={() => {
          onSubmit(from, to);
          setFrom(''); setTo('');
        }}
      >
        <Plus className="size-3.5" /> Add transition
      </Button>
    </div>
  );
}

function AddStatusDialog({
  open, onClose, onSubmit, isPending, error,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (input: { name: string; category: string; color: string }) => void;
  isPending: boolean;
  error: string | null;
}) {
  const [name,     setName]     = useState('');
  const [category, setCategory] = useState<Category>('TODO');
  const [color,    setColor]    = useState(CATEGORY_META.TODO.defaultColor);

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) { onClose(); setName(''); setCategory('TODO'); setColor(CATEGORY_META.TODO.defaultColor); }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add status</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit({ name: name.trim(), category, color });
          }}
        >
          <DialogBody className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="st-name" className="text-xs font-medium text-muted-foreground">Name</label>
              <Input
                id="st-name" required autoFocus value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. In Review"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="st-cat" className="text-xs font-medium text-muted-foreground">Category</label>
                <Select
                  value={category}
                  onValueChange={(v) => {
                    const next = v as Category;
                    setCategory(next);
                    // Re-seed the colour with the category's default unless the user has
                    // already chosen a custom one — saves them a colour-picker step.
                    setColor((prev) =>
                      Object.values(CATEGORY_META).some((m) => m.defaultColor === prev)
                        ? CATEGORY_META[next].defaultColor
                        : prev,
                    );
                  }}
                >
                  <SelectTrigger id="st-cat" className="h-9 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CATEGORY_ORDER.map((c) => (
                      <SelectItem key={c} value={c}>{CATEGORY_META[c].label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="st-color" className="text-xs font-medium text-muted-foreground">Colour</label>
                <div className="flex items-center gap-2">
                  <input
                    id="st-color" type="color" value={color}
                    onChange={(e) => setColor(e.target.value)}
                    className="size-9 rounded-md border border-input bg-transparent cursor-pointer"
                  />
                  <span className="font-mono text-xs text-muted-foreground">{color.toUpperCase()}</span>
                </div>
              </div>
            </div>
            {error && (
              <div className="rounded-md border-l-2 border-destructive bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {error}
              </div>
            )}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={isPending}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={isPending || !name.trim()}>
              {isPending ? 'Adding…' : 'Add status'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Empty / loading
// ─────────────────────────────────────────────────────────────────────────────

function WorkflowSkeleton() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
      {[0, 1].map((i) => (
        <Card key={i} className="p-4 flex flex-col gap-3">
          <Skeleton className="h-5 w-32" />
          {[0, 1, 2, 3].map((j) => <Skeleton key={j} className="h-9 w-full" />)}
        </Card>
      ))}
    </div>
  );
}

function EmptyProjectState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border p-8 text-center">
      <Workflow className="size-10 text-muted-foreground/50" aria-hidden="true" />
      <div className="space-y-1">
        <div className="text-sm font-medium text-foreground">No project to configure</div>
        <div className="text-xs text-muted-foreground max-w-sm">
          Create a project in this workspace to start defining its workflow.
        </div>
      </div>
    </div>
  );
}
