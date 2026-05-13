'use client';

import { useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Settings, Tag, Boxes, GitPullRequest, MessageSquare, Webhook,
  Plus, Trash2, Edit3, Search, Filter, X,
} from 'lucide-react';

import type { Label, ProjectComponent } from '@projectflow/types';

import { useStore } from '@/store/useStore';
import { notifyApiError } from '@/lib/apiErrorToast';
import GitIntegrationSettings from '@/components/GitIntegrationSettings';
import SlackTeamsSettings     from '@/components/SlackTeamsSettings';
import WebhookManager         from '@/components/WebhookManager';

import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody, DialogFooter,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

// ─── API helper ──────────────────────────────────────────────────────────────

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
  if (!res.ok) notifyApiError(json, res.status);
  return { ok: res.ok, status: res.status, json };
}

// ─── Constants ───────────────────────────────────────────────────────────────

type Tab = 'labels' | 'components' | 'git' | 'messaging' | 'webhooks';
const TABS: Array<{ value: Tab; label: string; icon: typeof Tag }> = [
  { value: 'labels',     label: 'Labels',          icon: Tag },
  { value: 'components', label: 'Components',      icon: Boxes },
  { value: 'git',        label: 'Git Integration', icon: GitPullRequest },
  { value: 'messaging',  label: 'Slack & Teams',   icon: MessageSquare },
  { value: 'webhooks',   label: 'Webhooks',        icon: Webhook },
];

// Eight ~accessible label colours covering the common hue families.
const PRESET_COLORS = [
  '#6366f1', '#ec4899', '#10b981', '#f59e0b',
  '#0ea5e9', '#eab308', '#a855f7', '#94a3b8',
];

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────

export default function ProjectSettingsPage() {
  const router      = useRouter();
  const searchParams = useSearchParams();
  const accessToken = useStore((s) => s.accessToken);

  const currentWorkspaceId  = useStore((s) => s.currentWorkspaceId);
  const currentProjectId    = useStore((s) => s.currentProjectId);
  const setCurrentWorkspace = useStore((s) => s.setCurrentWorkspace);
  const setCurrentProject   = useStore((s) => s.setCurrentProject);

  // Allow ?tab=git from external links (the sidebar uses /project-settings?tab=git).
  const initialTab = (searchParams.get('tab') as Tab | null) ?? 'labels';
  const [tab, setTab] = useState<Tab>(initialTab);

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
  const activeWorkspaceId = currentWorkspaceId ?? workspaces?.[0]?.Id ?? null;

  const { data: projects, isLoading: isLoadingProj } = useQuery<any[]>({
    queryKey: ['projects', activeWorkspaceId, accessToken],
    enabled: !!activeWorkspaceId,
    queryFn: async () => {
      const { ok, json } = await api(`/projects?workspaceId=${activeWorkspaceId}`, accessToken);
      return ok ? (json.data ?? []) : [];
    },
  });
  const activeProjectId = currentProjectId ?? projects?.[0]?.Id ?? null;
  const activeProject   = projects?.find((p: any) => p.Id === activeProjectId) ?? projects?.[0];

  const isInitialLoading = isLoadingWs || isLoadingProj;
  const noProject = !activeProjectId && !isLoadingProj && !isLoadingWs;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-full flex-col gap-4">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <div className="rounded-lg bg-primary/10 p-2 text-primary">
            <Settings className="size-5" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>Project settings</span>
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

      {isInitialLoading ? (
        <PageSkeleton />
      ) : noProject ? (
        <EmptyProjectState />
      ) : (
        <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} className="flex-1 min-h-0 flex flex-col">
          <TabsList className="self-start">
            {TABS.map((t) => {
              const Icon = t.icon;
              return (
                <TabsTrigger key={t.value} value={t.value} className="gap-1.5">
                  <Icon className="size-3.5" />
                  {t.label}
                </TabsTrigger>
              );
            })}
          </TabsList>

          <TabsContent value="labels" className="mt-3 flex-1 min-h-0">
            <LabelsTab projectId={activeProjectId!} />
          </TabsContent>
          <TabsContent value="components" className="mt-3 flex-1 min-h-0">
            <ComponentsTab projectId={activeProjectId!} />
          </TabsContent>
          <TabsContent value="git" className="mt-3 flex-1 min-h-0">
            {activeProject?.WorkspaceId && <GitIntegrationSettings workspaceId={activeProject.WorkspaceId} />}
          </TabsContent>
          <TabsContent value="messaging" className="mt-3 flex-1 min-h-0">
            {activeProject?.WorkspaceId && <SlackTeamsSettings workspaceId={activeProject.WorkspaceId} />}
          </TabsContent>
          <TabsContent value="webhooks" className="mt-3 flex-1 min-h-0">
            {activeProject?.WorkspaceId && <WebhookManager workspaceId={activeProject.WorkspaceId} />}
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Label badge (reusable — was previously exported from LabelManager.tsx)
// ─────────────────────────────────────────────────────────────────────────────

export function LabelBadge({ name, color }: { name: string; color: string }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium border whitespace-nowrap"
      style={{
        background: color + '22',
        color,
        borderColor: color + '55',
      }}
    >
      <span className="inline-block size-1.5 rounded-full" style={{ background: color }} />
      {name}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Labels tab
// ─────────────────────────────────────────────────────────────────────────────

function LabelsTab({ projectId }: { projectId: string }) {
  const qc          = useQueryClient();
  const accessToken = useStore((s) => s.accessToken);

  const [search,      setSearch]      = useState('');
  const [createOpen,  setCreateOpen]  = useState(false);
  const [editing,     setEditing]     = useState<Label | null>(null);

  const { data: labels, isLoading } = useQuery<Label[]>({
    queryKey: ['labels', projectId, accessToken],
    queryFn: async () => {
      const { ok, json } = await api(`/labels?projectId=${projectId}`, accessToken);
      return ok ? (json.labels ?? []) : [];
    },
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['labels', projectId] });

  const saveMutation = useMutation({
    mutationFn: async (input: { id?: string; name: string; color: string }) => {
      if (input.id) {
        const { ok, json } = await api(`/labels/${input.id}`, accessToken, {
          method: 'PATCH', body: JSON.stringify({ name: input.name, color: input.color }),
        });
        if (!ok) throw new Error(json?.error ?? 'Update failed');
        return json.label;
      }
      const { ok, json } = await api('/labels', accessToken, {
        method: 'POST', body: JSON.stringify({ projectId, name: input.name, color: input.color }),
      });
      if (!ok) throw new Error(json?.error ?? 'Create failed');
      return json.label;
    },
    onSuccess: () => { invalidate(); setCreateOpen(false); setEditing(null); },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { ok } = await api(`/labels/${id}`, accessToken, { method: 'DELETE' });
      if (!ok) throw new Error('Delete failed');
    },
    onSuccess: invalidate,
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return labels ?? [];
    return (labels ?? []).filter((l) => l.name.toLowerCase().includes(q));
  }, [labels, search]);

  return (
    <div className="flex flex-col gap-3 h-full">
      {/* Filter + new */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/30 p-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search label name…"
            className="h-8 pl-7 text-xs"
            aria-label="Filter labels"
          />
        </div>
        {search.trim() && (
          <Badge variant="outline" size="sm" appearance="outline" className="ml-1">
            <Filter className="size-3" /> 1
          </Badge>
        )}
        <Button size="sm" variant="primary" onClick={() => setCreateOpen(true)}>
          <Plus className="size-4" /> New label
        </Button>
        <div className="ml-auto text-xs text-muted-foreground">
          <strong className="text-foreground">{filtered.length}</strong> of {labels?.length ?? 0}
        </div>
      </div>

      {isLoading ? (
        <ListSkeleton rows={4} />
      ) : !labels || labels.length === 0 ? (
        <EmptyTabState
          icon={Tag}
          title="No labels yet"
          body="Labels let you tag issues with quick visual markers — bug, frontend, customer-request, etc."
          ctaLabel="Create your first label"
          onCreate={() => setCreateOpen(true)}
        />
      ) : filtered.length === 0 ? (
        <NoResultsState />
      ) : (
        <Card className="p-0 overflow-hidden">
          <ul role="list" className="divide-y divide-border/60">
            {filtered.map((l) => (
              <li key={l.id} className="group flex items-center gap-3 px-4 py-2.5 hover:bg-muted/20 transition-colors">
                <LabelBadge name={l.name} color={l.color} />
                <span className="text-xs text-muted-foreground">
                  {l.issueCount} {l.issueCount === 1 ? 'issue' : 'issues'}
                </span>
                <div className="ml-auto flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setEditing(l)} aria-label={`Edit ${l.name}`}>
                    <Edit3 className="size-3.5" />
                  </Button>
                  <Button
                    size="sm" variant="ghost"
                    className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                    onClick={() => { if (window.confirm(`Delete label "${l.name}"?`)) deleteMutation.mutate(l.id); }}
                    disabled={deleteMutation.isPending}
                    aria-label={`Delete ${l.name}`}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <LabelDialog
        mode="create"
        open={createOpen}
        initial={null}
        onClose={() => setCreateOpen(false)}
        onSubmit={(input) => saveMutation.mutate(input)}
        isPending={saveMutation.isPending}
        error={(saveMutation.error as Error | null)?.message ?? null}
      />
      <LabelDialog
        mode="edit"
        open={!!editing}
        initial={editing}
        onClose={() => setEditing(null)}
        onSubmit={(input) => saveMutation.mutate({ ...input, id: editing!.id })}
        isPending={saveMutation.isPending}
        error={(saveMutation.error as Error | null)?.message ?? null}
      />
    </div>
  );
}

function LabelDialog({
  mode, open, initial, onClose, onSubmit, isPending, error,
}: {
  mode: 'create' | 'edit';
  open: boolean;
  initial: Label | null;
  onClose: () => void;
  onSubmit: (input: { name: string; color: string }) => void;
  isPending: boolean;
  error: string | null;
}) {
  const [name,  setName]  = useState(initial?.name  ?? '');
  const [color, setColor] = useState(initial?.color ?? PRESET_COLORS[0]!);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent key={initial?.id ?? mode}>
        <DialogHeader>
          <DialogTitle>{mode === 'create' ? 'New label' : `Edit ${initial?.name}`}</DialogTitle>
        </DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); onSubmit({ name: name.trim(), color }); }}>
          <DialogBody className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="lbl-name" className="text-xs font-medium text-muted-foreground">Name</label>
              <Input
                id="lbl-name" required autoFocus value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. bug, frontend, customer"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">Colour</label>
              <div className="flex items-center gap-2 flex-wrap">
                {PRESET_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={cn(
                      'size-7 rounded-full border-2 transition-all',
                      color === c ? 'border-foreground scale-110 ring-2 ring-foreground/20' : 'border-transparent hover:scale-105',
                    )}
                    style={{ background: c }}
                    onClick={() => setColor(c)}
                    aria-label={`Pick colour ${c}`}
                  />
                ))}
                <label
                  className="size-7 rounded-full border border-input cursor-pointer flex items-center justify-center text-muted-foreground hover:text-foreground"
                  style={{ background: !PRESET_COLORS.includes(color) ? color : 'transparent' }}
                  title="Pick custom colour"
                >
                  <input
                    type="color" value={color}
                    onChange={(e) => setColor(e.target.value)}
                    className="opacity-0 size-0"
                    aria-label="Pick custom colour"
                  />
                  {PRESET_COLORS.includes(color) && '+'}
                </label>
                <span className="font-mono text-xs text-muted-foreground ml-1">{color.toUpperCase()}</span>
              </div>
            </div>
            <div className="flex items-center gap-2 rounded-md bg-muted/30 px-3 py-2">
              <span className="text-xs text-muted-foreground">Preview:</span>
              <LabelBadge name={name.trim() || 'label'} color={color} />
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
              {isPending ? 'Saving…' : mode === 'create' ? 'Create label' : 'Save changes'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Components tab
// ─────────────────────────────────────────────────────────────────────────────

function ComponentsTab({ projectId }: { projectId: string }) {
  const qc          = useQueryClient();
  const accessToken = useStore((s) => s.accessToken);

  const [search,      setSearch]      = useState('');
  const [createOpen,  setCreateOpen]  = useState(false);
  const [editing,     setEditing]     = useState<ProjectComponent | null>(null);

  const { data: components, isLoading } = useQuery<ProjectComponent[]>({
    queryKey: ['components', projectId, accessToken],
    queryFn: async () => {
      const { ok, json } = await api(`/components?projectId=${projectId}`, accessToken);
      return ok ? (json.components ?? []) : [];
    },
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['components', projectId] });

  const saveMutation = useMutation({
    mutationFn: async (input: { id?: string; name: string; description: string }) => {
      if (input.id) {
        const { ok, json } = await api(`/components/${input.id}`, accessToken, {
          method: 'PATCH',
          body: JSON.stringify({ name: input.name, description: input.description || null }),
        });
        if (!ok) throw new Error(json?.error ?? 'Update failed');
        return json.component;
      }
      const { ok, json } = await api('/components', accessToken, {
        method: 'POST',
        body: JSON.stringify({
          projectId, name: input.name, description: input.description, leadUserId: '',
        }),
      });
      if (!ok) throw new Error(json?.error ?? 'Create failed');
      return json.component;
    },
    onSuccess: () => { invalidate(); setCreateOpen(false); setEditing(null); },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { ok } = await api(`/components/${id}`, accessToken, { method: 'DELETE' });
      if (!ok) throw new Error('Delete failed');
    },
    onSuccess: invalidate,
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return components ?? [];
    return (components ?? []).filter(
      (c) => c.name.toLowerCase().includes(q) || (c.description ?? '').toLowerCase().includes(q),
    );
  }, [components, search]);

  return (
    <div className="flex flex-col gap-3 h-full">
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/30 p-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search components…"
            className="h-8 pl-7 text-xs"
            aria-label="Filter components"
          />
        </div>
        {search.trim() && (
          <Badge variant="outline" size="sm" appearance="outline" className="ml-1">
            <Filter className="size-3" /> 1
          </Badge>
        )}
        <Button size="sm" variant="primary" onClick={() => setCreateOpen(true)}>
          <Plus className="size-4" /> New component
        </Button>
        <div className="ml-auto text-xs text-muted-foreground">
          <strong className="text-foreground">{filtered.length}</strong> of {components?.length ?? 0}
        </div>
      </div>

      {isLoading ? (
        <ListSkeleton rows={3} />
      ) : !components || components.length === 0 ? (
        <EmptyTabState
          icon={Boxes}
          title="No components yet"
          body="Components let you split a project into functional areas — Frontend, Auth, Database — and optionally assign each one a lead."
          ctaLabel="Create your first component"
          onCreate={() => setCreateOpen(true)}
        />
      ) : filtered.length === 0 ? (
        <NoResultsState />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {filtered.map((c) => (
            <Card key={c.id} className="p-4 flex flex-col gap-2">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="inline-flex size-8 items-center justify-center rounded-md bg-primary/10 text-primary shrink-0">
                    <Boxes className="size-4" />
                  </span>
                  <h3 className="text-sm font-semibold text-foreground truncate">{c.name}</h3>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setEditing(c)} aria-label="Edit">
                    <Edit3 className="size-3.5" />
                  </Button>
                  <Button
                    size="sm" variant="ghost"
                    className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                    onClick={() => { if (window.confirm(`Delete component "${c.name}"?`)) deleteMutation.mutate(c.id); }}
                    disabled={deleteMutation.isPending}
                    aria-label="Delete"
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </div>
              {c.description && (
                <p className="text-xs text-muted-foreground line-clamp-2 whitespace-pre-wrap">
                  {c.description}
                </p>
              )}
              <div className="flex flex-wrap items-center gap-1.5 mt-1">
                {c.leadUserName && (
                  <Badge size="xs" variant="outline" appearance="outline">
                    Lead: {c.leadUserName}
                  </Badge>
                )}
                <Badge size="xs" variant="outline" appearance="outline" className="font-normal">
                  {c.issueCount} {c.issueCount === 1 ? 'issue' : 'issues'}
                </Badge>
              </div>
            </Card>
          ))}
        </div>
      )}

      <ComponentDialog
        mode="create"
        open={createOpen}
        initial={null}
        onClose={() => setCreateOpen(false)}
        onSubmit={(input) => saveMutation.mutate(input)}
        isPending={saveMutation.isPending}
        error={(saveMutation.error as Error | null)?.message ?? null}
      />
      <ComponentDialog
        mode="edit"
        open={!!editing}
        initial={editing}
        onClose={() => setEditing(null)}
        onSubmit={(input) => saveMutation.mutate({ ...input, id: editing!.id })}
        isPending={saveMutation.isPending}
        error={(saveMutation.error as Error | null)?.message ?? null}
      />
    </div>
  );
}

function ComponentDialog({
  mode, open, initial, onClose, onSubmit, isPending, error,
}: {
  mode: 'create' | 'edit';
  open: boolean;
  initial: ProjectComponent | null;
  onClose: () => void;
  onSubmit: (input: { name: string; description: string }) => void;
  isPending: boolean;
  error: string | null;
}) {
  const [name,        setName]        = useState(initial?.name        ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent key={initial?.id ?? mode}>
        <DialogHeader>
          <DialogTitle>{mode === 'create' ? 'New component' : `Edit ${initial?.name}`}</DialogTitle>
        </DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); onSubmit({ name: name.trim(), description: description.trim() }); }}>
          <DialogBody className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="cmp-name" className="text-xs font-medium text-muted-foreground">Name</label>
              <Input
                id="cmp-name" required autoFocus value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Frontend, Auth, Database"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="cmp-desc" className="text-xs font-medium text-muted-foreground">Description</label>
              <textarea
                id="cmp-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                placeholder="What does this component cover?"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:border-ring resize-none"
              />
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
              {isPending ? 'Saving…' : mode === 'create' ? 'Create component' : 'Save changes'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared skeleton / empty
// ─────────────────────────────────────────────────────────────────────────────

function PageSkeleton() {
  return (
    <>
      <Skeleton className="h-9 w-[400px]" />
      <div className="flex flex-col gap-3 mt-3">
        {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
      </div>
    </>
  );
}

function ListSkeleton({ rows }: { rows: number }) {
  return (
    <Card className="p-2 flex flex-col gap-2">
      {Array.from({ length: rows }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
    </Card>
  );
}

function EmptyProjectState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border p-8 text-center">
      <Settings className="size-10 text-muted-foreground/50" aria-hidden="true" />
      <div className="space-y-1">
        <div className="text-sm font-medium text-foreground">No project to configure</div>
        <div className="text-xs text-muted-foreground max-w-sm">
          Create a project in this workspace to set up labels, components, and integrations.
        </div>
      </div>
    </div>
  );
}

function EmptyTabState({
  icon: Icon, title, body, ctaLabel, onCreate,
}: {
  icon: typeof Tag;
  title: string;
  body: string;
  ctaLabel: string;
  onCreate: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border p-8 text-center">
      <Icon className="size-10 text-muted-foreground/50" aria-hidden="true" />
      <div className="space-y-1">
        <div className="text-sm font-medium text-foreground">{title}</div>
        <div className="text-xs text-muted-foreground max-w-sm">{body}</div>
      </div>
      <Button size="sm" variant="primary" onClick={onCreate}>
        <Plus className="size-4" /> {ctaLabel}
      </Button>
    </div>
  );
}

function NoResultsState() {
  return (
    <div className="rounded-lg border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
      No matches for the current filter.
    </div>
  );
}
