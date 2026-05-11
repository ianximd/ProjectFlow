'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Folder, ArrowLeft, Save, Archive, ArchiveRestore, Trash2, AlertTriangle,
  Settings as SettingsIcon, Briefcase, Workflow, Kanban,
} from 'lucide-react';

import { useStore } from '@/store/useStore';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

// ── Types & meta ─────────────────────────────────────────────────────────────

type ProjectType   = 'KANBAN' | 'SCRUM' | 'BUSINESS';
type ProjectStatus = 'ACTIVE' | 'ARCHIVED' | 'DELETED';

const TYPE_META: Record<ProjectType, { label: string; icon: typeof Kanban; cls: string }> = {
  KANBAN:   { label: 'Kanban',   icon: Kanban,   cls: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300' },
  SCRUM:    { label: 'Scrum',    icon: Workflow, cls: 'bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300' },
  BUSINESS: { label: 'Business', icon: Briefcase, cls: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300' },
};

const STATUS_META: Record<ProjectStatus, { label: string; cls: string }> = {
  ACTIVE:   { label: 'Active',   cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300' },
  ARCHIVED: { label: 'Archived', cls: 'bg-slate-100 text-slate-600  dark:bg-slate-800  dark:text-slate-400' },
  DELETED:  { label: 'Deleted',  cls: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300' },
};

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

// Date inputs use YYYY-MM-DD; the API returns ISO timestamps. Convert.
function isoToDateInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

// ─────────────────────────────────────────────────────────────────────────────

export default function ProjectSettingsPage() {
  const params       = useParams<{ id: string }>();
  const router       = useRouter();
  const qc           = useQueryClient();
  const accessToken  = useStore((s) => s.accessToken);
  const projectId    = params.id;

  const { data: project, isLoading } = useQuery<Record<string, any> | null>({
    queryKey: ['project', projectId, accessToken],
    enabled: !!projectId,
    queryFn: async () => {
      const { ok, json } = await api(`/projects/${projectId}`, accessToken);
      return ok ? (json.data ?? null) : null;
    },
  });

  // ── Form state (seeded from upstream) ──────────────────────────────────────
  const [name,        setName]        = useState('');
  const [description, setDescription] = useState('');
  const [avatarUrl,   setAvatarUrl]   = useState('');
  const [type,        setType]        = useState<ProjectType>('KANBAN');
  const [startDate,   setStartDate]   = useState('');
  const [endDate,     setEndDate]     = useState('');

  useEffect(() => {
    if (!project) return;
    setName(project.Name ?? '');
    setDescription(project.Description ?? '');
    setAvatarUrl(project.AvatarUrl ?? '');
    setType(((project.Type ?? 'KANBAN') as ProjectType));
    setStartDate(isoToDateInput(project.StartDate));
    setEndDate(isoToDateInput(project.EndDate));
  }, [project]);

  // ── Mutations ──────────────────────────────────────────────────────────────
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['project', projectId] });
    // Refresh the projects list pages too
    qc.invalidateQueries({ queryKey: ['projects'] });
    qc.invalidateQueries({ queryKey: ['projects-manage'] });
  };

  const updateMutation = useMutation({
    mutationFn: async (patch: Record<string, unknown>) => {
      const { ok, json } = await api(`/projects/${projectId}`, accessToken, {
        method: 'PATCH', body: JSON.stringify(patch),
      });
      if (!ok) throw new Error(json?.error?.message ?? 'Update failed');
      return json.data;
    },
    onSuccess: invalidate,
  });

  const archiveMutation = useMutation({
    mutationFn: async () => {
      const { ok, json } = await api(`/projects/${projectId}/archive`, accessToken, { method: 'POST' });
      if (!ok) throw new Error(json?.error?.message ?? 'Archive failed');
    },
    onSuccess: invalidate,
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const { ok } = await api(`/projects/${projectId}`, accessToken, { method: 'DELETE' });
      if (!ok) throw new Error('Delete failed');
    },
    onSuccess: () => {
      invalidate();
      router.push('/projects');
    },
  });

  // ── Derived ────────────────────────────────────────────────────────────────
  const status = (project?.Status ?? 'ACTIVE') as ProjectStatus;
  const sm     = STATUS_META[status];
  const tm     = TYPE_META[type];

  const dirty =
    !!project && (
      name        !== (project.Name        ?? '') ||
      description !== (project.Description ?? '') ||
      avatarUrl   !== (project.AvatarUrl   ?? '') ||
      type        !== ((project.Type       ?? 'KANBAN') as ProjectType) ||
      startDate   !== isoToDateInput(project.StartDate) ||
      endDate     !== isoToDateInput(project.EndDate)
    );

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!project) return;
    const patch: Record<string, unknown> = {};
    // PATCH semantics — only send fields that changed.
    if (name        !== (project.Name        ?? '')) patch.name        = name;
    if (description !== (project.Description ?? '')) patch.description = description || null;
    if (avatarUrl   !== (project.AvatarUrl   ?? '')) patch.avatarUrl   = avatarUrl   || null;
    if (type        !== ((project.Type ?? 'KANBAN') as ProjectType)) patch.type = type;
    if (startDate   !== isoToDateInput(project.StartDate)) {
      patch.startDate = startDate ? new Date(startDate).toISOString() : null;
    }
    if (endDate     !== isoToDateInput(project.EndDate)) {
      patch.endDate   = endDate ? new Date(endDate).toISOString() : null;
    }
    if (Object.keys(patch).length === 0) return;
    updateMutation.mutate(patch);
  };

  return (
    <div className="flex h-full flex-col gap-4 max-w-3xl">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3">
        <Link href="/projects" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" />
        </Link>
        <div className="rounded-lg bg-primary/10 p-2 text-primary">
          <SettingsIcon className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>Project settings</span>
            {project?.Key && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-mono">{project.Key}</span>
              </>
            )}
          </div>
          <h2 className="text-base font-semibold text-foreground truncate inline-flex items-center gap-2">
            {project?.Name ?? (isLoading ? 'Loading…' : 'Project')}
            {project && (
              <Badge size="xs" variant="outline" appearance="outline" className={cn('font-normal', sm.cls)}>
                {sm.label}
              </Badge>
            )}
          </h2>
        </div>
      </div>

      {isLoading ? (
        <PageSkeleton />
      ) : !project ? (
        <Card className="p-6 text-center text-sm text-muted-foreground">
          Project not found, or you no longer have access.
        </Card>
      ) : (
        <>
          {/* ── General ──────────────────────────────────────────────────── */}
          <Card className="p-5">
            <div className="flex items-start justify-between gap-3 mb-4">
              <div>
                <h3 className="text-sm font-semibold text-foreground">General</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Identity and timeline for this project.
                </p>
              </div>
              <Link
                href="/project-settings"
                className="text-xs text-primary hover:underline inline-flex items-center gap-1"
              >
                Configure labels, components, integrations →
              </Link>
            </div>

            <form onSubmit={submit} className="flex flex-col gap-4">
              <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3">
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="p-name" className="text-xs font-medium text-muted-foreground">Name</label>
                  <Input id="p-name" required value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                <div className="flex flex-col gap-1.5 min-w-[120px]">
                  <label className="text-xs font-medium text-muted-foreground">Key</label>
                  <div className="h-9 flex items-center rounded-md border border-input bg-muted/40 px-3 font-mono text-sm">
                    {project.Key}
                  </div>
                </div>
              </div>
              <p className="text-xs text-muted-foreground -mt-2">
                The project key is fixed once created — issues already reference it (e.g. <code className="font-mono">{project.Key}-42</code>).
              </p>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="p-desc" className="text-xs font-medium text-muted-foreground">Description</label>
                <textarea
                  id="p-desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                  placeholder="What does this project track?"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:border-ring resize-none"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-muted-foreground">Type</label>
                <div className="grid grid-cols-3 gap-2">
                  {(Object.keys(TYPE_META) as ProjectType[]).map((t) => {
                    const meta = TYPE_META[t];
                    const Icon = meta.icon;
                    const active = type === t;
                    return (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setType(t)}
                        className={cn(
                          'flex flex-col items-center gap-1 rounded-md border px-2 py-3 text-xs font-medium transition-colors',
                          active
                            ? 'border-primary bg-primary/10 text-primary'
                            : 'border-border bg-card text-foreground hover:bg-muted/40',
                        )}
                        aria-pressed={active}
                      >
                        <Icon className="size-4" />
                        {meta.label}
                      </button>
                    );
                  })}
                </div>
                <p className="text-xs text-muted-foreground">
                  Type affects how the board and reports render — Scrum surfaces sprints prominently;
                  Kanban skips the sprint workflow.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="p-start" className="text-xs font-medium text-muted-foreground">Start date</label>
                  <Input id="p-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="p-end" className="text-xs font-medium text-muted-foreground">End date</label>
                  <Input id="p-end" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="p-avatar" className="text-xs font-medium text-muted-foreground">Avatar URL (optional)</label>
                <Input
                  id="p-avatar" type="url" value={avatarUrl}
                  onChange={(e) => setAvatarUrl(e.target.value)}
                  placeholder="https://…/logo.png"
                />
              </div>

              {(updateMutation.error as Error | null) && (
                <div className="rounded-md border-l-2 border-destructive bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  {(updateMutation.error as Error).message}
                </div>
              )}

              <div className="flex items-center gap-2">
                <Button type="submit" variant="primary" disabled={!dirty || updateMutation.isPending}>
                  <Save className="size-4" />
                  {updateMutation.isPending ? 'Saving…' : 'Save changes'}
                </Button>
                {dirty && (
                  <Button
                    type="button" variant="ghost"
                    onClick={() => {
                      setName(project.Name ?? '');
                      setDescription(project.Description ?? '');
                      setAvatarUrl(project.AvatarUrl ?? '');
                      setType(((project.Type ?? 'KANBAN') as ProjectType));
                      setStartDate(isoToDateInput(project.StartDate));
                      setEndDate(isoToDateInput(project.EndDate));
                    }}
                  >
                    Discard
                  </Button>
                )}
                <div className="ml-auto text-xs text-muted-foreground">
                  <Badge size="xs" variant="outline" appearance="outline" className={cn('font-normal mr-1', tm.cls)}>
                    {tm.label}
                  </Badge>
                  selected
                </div>
              </div>
            </form>
          </Card>

          {/* ── Lifecycle ─────────────────────────────────────────────────── */}
          <Card className="p-5">
            <h3 className="text-sm font-semibold text-foreground mb-1">Lifecycle</h3>
            <p className="text-xs text-muted-foreground mb-4">
              Pause work without losing data, or restore an archived project.
            </p>

            {status === 'ACTIVE' ? (
              <div className="flex items-center gap-3">
                <Button
                  variant="outline"
                  onClick={() => {
                    if (window.confirm(`Archive ${project.Name}?\n\nArchived projects keep all their data but disappear from default switchers. You can restore at any time.`)) {
                      archiveMutation.mutate();
                    }
                  }}
                  disabled={archiveMutation.isPending}
                >
                  <Archive className="size-4" />
                  {archiveMutation.isPending ? 'Archiving…' : 'Archive project'}
                </Button>
                <span className="text-xs text-muted-foreground">Hides the project from switchers; nothing is deleted.</span>
              </div>
            ) : status === 'ARCHIVED' ? (
              <div className="flex items-center gap-3">
                <Button
                  variant="outline"
                  onClick={() =>
                    updateMutation.mutate({ status: 'ACTIVE' as ProjectStatus })
                  }
                  disabled={updateMutation.isPending}
                >
                  <ArchiveRestore className="size-4" />
                  {updateMutation.isPending ? 'Restoring…' : 'Restore project'}
                </Button>
                <span className="text-xs text-muted-foreground">Returns the project to active switchers and reports.</span>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">This project is deleted and read-only.</p>
            )}

            {(archiveMutation.error as Error | null) && (
              <div className="mt-3 rounded-md border-l-2 border-destructive bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {(archiveMutation.error as Error).message}
              </div>
            )}
          </Card>

          {/* ── Danger zone ──────────────────────────────────────────────── */}
          <Card className="p-5 border-destructive/40">
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle className="size-4 text-destructive" />
              <h3 className="text-sm font-semibold text-destructive">Danger zone</h3>
            </div>
            <DeleteProjectPanel
              expectedKey={project.Key}
              onConfirm={() => deleteMutation.mutate()}
              isPending={deleteMutation.isPending}
              error={(deleteMutation.error as Error | null)?.message ?? null}
            />
          </Card>
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Delete panel
// ─────────────────────────────────────────────────────────────────────────────

function DeleteProjectPanel({
  expectedKey, onConfirm, isPending, error,
}: {
  expectedKey: string;
  onConfirm: () => void;
  isPending: boolean;
  error: string | null;
}) {
  const [confirmInput, setConfirmInput] = useState('');
  const matches = confirmInput.trim().toUpperCase() === expectedKey;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Deleting a project soft-deletes its issues, sprints, and workflow. They stay in the database
        for audit but stop appearing in the app. <strong>This cannot be undone from the UI.</strong>
      </p>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="p-confirm" className="text-xs font-medium text-muted-foreground">
          Type <code className="font-mono text-foreground">{expectedKey}</code> to confirm
        </label>
        <Input
          id="p-confirm"
          value={confirmInput}
          onChange={(e) => setConfirmInput(e.target.value)}
          className="font-mono text-sm uppercase max-w-sm"
          autoComplete="off"
        />
      </div>
      {error && (
        <div className="rounded-md border-l-2 border-destructive bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}
      <div>
        <Button variant="destructive" onClick={onConfirm} disabled={!matches || isPending}>
          <Trash2 className="size-4" />
          {isPending ? 'Deleting…' : 'Delete project'}
        </Button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Loading
// ─────────────────────────────────────────────────────────────────────────────

function PageSkeleton() {
  return (
    <>
      <Skeleton className="h-72 rounded-xl" />
      <Skeleton className="h-24 rounded-xl" />
      <Skeleton className="h-40 rounded-xl" />
    </>
  );
}
