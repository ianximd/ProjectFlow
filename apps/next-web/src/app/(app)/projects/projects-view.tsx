// apps/next-web/src/app/(app)/projects/projects-view.tsx
'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Folder, Plus, Search, Filter, X, LayoutGrid, Settings, Archive,
  Trash2, Briefcase, ArchiveX, Workflow, Kanban,
} from 'lucide-react';

import { useStore } from '@/store/useStore';
import { notifyApiError } from '@/lib/apiErrorToast';
import { setSelection } from '@/server/actions/selection';
import { createProject, archiveProject, deleteProject } from '@/server/actions/projects';
import type { Project, ProjectType, ProjectStatus, Workspace } from '@/server/queries/normalize';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody, DialogFooter,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

// ── Lookup tables (moved verbatim from the old page.tsx) ──────────────────────
const TYPE_META: Record<ProjectType, { label: string; icon: typeof Kanban; cls: string }> = {
  KANBAN:   { label: 'Kanban',   icon: Kanban,   cls: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300' },
  SCRUM:    { label: 'Scrum',    icon: Workflow, cls: 'bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300' },
  BUSINESS: { label: 'Business', icon: Briefcase,cls: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300' },
};

const STATUS_META: Record<ProjectStatus, { label: string; cls: string }> = {
  ACTIVE:   { label: 'Active',   cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300' },
  ARCHIVED: { label: 'Archived', cls: 'bg-slate-100 text-slate-600  dark:bg-slate-800  dark:text-slate-400' },
  DELETED:  { label: 'Deleted',  cls: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300' },
};

// Suggest a project key from a name: take initials, uppercase, max 4 chars.
function suggestKey(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0]!.slice(0, 4).toUpperCase();
  return parts.map((p) => p[0]).join('').slice(0, 4).toUpperCase();
}

// ─────────────────────────────────────────────────────────────────────────────

export function ProjectsView({
  workspaces, projects, activeWorkspaceId, cookieWorkspaceId,
}: {
  workspaces: Workspace[];
  projects: Project[];
  activeWorkspaceId: string;
  cookieWorkspaceId: string | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [search,       setSearch]       = useState('');
  const [typeFilter,   setTypeFilter]   = useState<'ALL' | ProjectType>('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | ProjectStatus>('ALL');
  const [createOpen,   setCreateOpen]   = useState(false);
  const [createError,  setCreateError]  = useState<string | null>(null);

  // ── Selection bridge ────────────────────────────────────────────────────────
  // The cookie (pf_sel) is authoritative for migrated (server) pages; the other
  // 10 pages still read currentWorkspaceId from zustand. Keep them in sync until
  // Phase 3 removes zustand selection.
  const setCurrentWorkspace = useStore((s) => s.setCurrentWorkspace);
  const legacyWorkspaceId   = useStore((s) => s.currentWorkspaceId);

  useEffect(() => {
    // First migrated visit with an empty selection cookie: seed it from the
    // legacy localStorage selection, then refresh so the server renders that ws.
    if (
      cookieWorkspaceId === null &&
      legacyWorkspaceId &&
      legacyWorkspaceId !== activeWorkspaceId &&
      workspaces.some((w) => w.id === legacyWorkspaceId)
    ) {
      startTransition(async () => {
        await setSelection({ workspaceId: legacyWorkspaceId });
        router.refresh();
      });
      return;
    }
    // Otherwise make zustand reflect the cookie/server truth for legacy pages.
    if (legacyWorkspaceId !== activeWorkspaceId) setCurrentWorkspace(activeWorkspaceId);
    // Deps are intentionally minimal: re-run only when the server-authoritative
    // values change (activeWorkspaceId, cookieWorkspaceId). Including
    // legacyWorkspaceId would create a feedback loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWorkspaceId, cookieWorkspaceId]);

  const activeWorkspace = workspaces.find((w) => w.id === activeWorkspaceId) ?? workspaces[0];

  function switchWorkspace(id: string) {
    setCurrentWorkspace(id);                 // legacy pages
    startTransition(async () => {
      await setSelection({ workspaceId: id }); // cookie → revalidate → server re-render
    });
  }

  // ── Mutations via Server Actions ─────────────────────────────────────────────
  function handleCreate(input: { name: string; key: string; type: ProjectType; description: string }) {
    setCreateError(null);
    startTransition(async () => {
      const res = await createProject({ workspaceId: activeWorkspaceId, ...input });
      if (res.ok) setCreateOpen(false);
      else setCreateError(res.error);
    });
  }

  function handleArchive(p: Project) {
    if (p.status === 'ARCHIVED') return;
    if (!window.confirm(`Archive ${p.name}?\n\nArchived projects stay readable but won't appear in switchers by default.`)) return;
    startTransition(async () => {
      const res = await archiveProject(p.id);
      if (!res.ok) notifyApiError({ error: { message: res.error } }, 0);
    });
  }

  function handleDelete(p: Project) {
    if (!window.confirm(`Delete ${p.name}?\n\nThis soft-deletes the project. All its issues, sprints, and workflow stay in the database but become invisible.`)) return;
    startTransition(async () => {
      const res = await deleteProject(p.id);
      if (!res.ok) notifyApiError({ error: { message: res.error } }, 0);
    });
  }

  // ── Filter pipeline (normalized fields) ──────────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return projects.filter((p) => {
      if (typeFilter   !== 'ALL' && p.type   !== typeFilter)   return false;
      if (statusFilter !== 'ALL' && p.status !== statusFilter) return false;
      if (q) {
        const hay = `${p.name} ${p.key} ${p.description ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [projects, search, typeFilter, statusFilter]);

  const kpi = useMemo(() => ({
    total:    projects.length,
    active:   projects.filter((p) => p.status === 'ACTIVE').length,
    archived: projects.filter((p) => p.status === 'ARCHIVED').length,
    kanban:   projects.filter((p) => p.type === 'KANBAN').length,
  }), [projects]);

  const activeFilterCount =
    (typeFilter   !== 'ALL' ? 1 : 0) +
    (statusFilter !== 'ALL' ? 1 : 0) +
    (search.trim() ? 1 : 0);

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-full flex-col gap-4">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <div className="rounded-lg bg-primary/10 p-2 text-primary">
            <Folder className="size-5" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>Projects</span>
              {activeWorkspace?.name && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>{activeWorkspace.name}</span>
                </>
              )}
            </div>
            <h2 className="text-base font-semibold text-foreground truncate">Manage projects</h2>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {workspaces.length > 1 && (
            <Select value={activeWorkspaceId} onValueChange={switchWorkspace}>
              <SelectTrigger className="h-8 w-[200px] text-xs" disabled={isPending}>
                <SelectValue placeholder="Workspace" />
              </SelectTrigger>
              <SelectContent>
                {workspaces.map((ws) => (
                  <SelectItem key={ws.id} value={ws.id}>{ws.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button size="sm" variant="primary" onClick={() => setCreateOpen(true)} disabled={!activeWorkspaceId}>
            <Plus className="size-4" /> New project
          </Button>
        </div>
      </div>

      {/* ── KPI tiles ──────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiTile icon={Folder}   label="Total projects" value={kpi.total}    tone="default" />
        <KpiTile icon={Workflow} label="Active"         value={kpi.active}   tone="success" />
        <KpiTile icon={ArchiveX} label="Archived"       value={kpi.archived} tone="muted" />
        <KpiTile icon={Kanban}   label="Kanban boards"  value={kpi.kanban}   tone="info" />
      </div>

      {/* ── Filter bar ─────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/30 p-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, key, or description…"
            className="h-8 pl-7 text-xs"
            aria-label="Filter projects"
          />
        </div>

        <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as 'ALL' | ProjectType)}>
          <SelectTrigger className="h-8 w-[130px] text-xs"><SelectValue placeholder="Type" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All types</SelectItem>
            {(Object.keys(TYPE_META) as ProjectType[]).map((t) => (
              <SelectItem key={t} value={t}>{TYPE_META[t].label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as 'ALL' | ProjectStatus)}>
          <SelectTrigger className="h-8 w-[140px] text-xs"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All statuses</SelectItem>
            <SelectItem value="ACTIVE">Active</SelectItem>
            <SelectItem value="ARCHIVED">Archived</SelectItem>
          </SelectContent>
        </Select>

        {activeFilterCount > 0 && (
          <>
            <Badge variant="outline" size="sm" appearance="outline" className="ml-1">
              <Filter className="size-3" /> {activeFilterCount}
            </Badge>
            <Button
              size="sm" variant="ghost"
              onClick={() => { setSearch(''); setTypeFilter('ALL'); setStatusFilter('ALL'); }}
              className="h-8 px-2 text-xs"
            >
              <X className="size-3.5" /> Clear
            </Button>
          </>
        )}

        <div className="ml-auto text-xs text-muted-foreground">
          Showing <strong className="text-foreground">{filtered.length}</strong> of <strong className="text-foreground">{projects.length}</strong>
        </div>
      </div>

      {/* ── Body ───────────────────────────────────────────────────────────── */}
      {projects.length === 0 ? (
        <EmptyState onCreate={() => setCreateOpen(true)} />
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
          No projects match the current filters.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map((p) => (
            <ProjectCard
              key={p.id}
              project={p}
              busy={isPending}
              onArchive={() => handleArchive(p)}
              onDelete={() => handleDelete(p)}
            />
          ))}
        </div>
      )}

      <CreateProjectDialog
        open={createOpen}
        onClose={() => { setCreateOpen(false); setCreateError(null); }}
        onSubmit={handleCreate}
        isPending={isPending}
        error={createError}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Project card
// ─────────────────────────────────────────────────────────────────────────────

function ProjectCard({
  project, onArchive, onDelete, busy,
}: {
  project: Project;
  onArchive: () => void;
  onDelete: () => void;
  busy: boolean;
}) {
  const { id, name, key, description: desc, type, status, createdAt } = project;
  const tm = TYPE_META[type] ?? TYPE_META.KANBAN;
  const sm = STATUS_META[status] ?? STATUS_META.ACTIVE;
  const TypeIcon = tm.icon;

  return (
    <Card className={cn('p-4 flex flex-col gap-3', status !== 'ACTIVE' && 'opacity-70')}>
      <div className="flex items-start gap-3">
        <span className={cn('inline-flex size-9 items-center justify-center rounded-md shrink-0', tm.cls)}>
          <TypeIcon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 min-w-0">
            <h3 className="text-sm font-semibold text-foreground truncate">{name}</h3>
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
            <span className="font-mono">{key}</span>
            <span aria-hidden="true">·</span>
            <Badge size="xs" variant="outline" appearance="outline" className="font-normal">{tm.label}</Badge>
            <Badge size="xs" variant="outline" appearance="outline" className={cn('font-normal', sm.cls)}>{sm.label}</Badge>
          </div>
        </div>
      </div>

      {desc && (
        <p className="text-xs text-muted-foreground line-clamp-2 whitespace-pre-wrap">{desc}</p>
      )}

      <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-1 border-t border-border/40">
        <Link href="/board" className="contents">
          <Button size="sm" variant="outline"><LayoutGrid className="size-3.5" /> Open board</Button>
        </Link>
        <Link href={`/projects/${id}/settings`} className="contents">
          <Button size="sm" variant="ghost"><Settings className="size-3.5" /> Settings</Button>
        </Link>
        {status === 'ACTIVE' && (
          <Button size="sm" variant="ghost" onClick={onArchive} disabled={busy} aria-label={`Archive ${name}`}>
            <Archive className="size-3.5" />
          </Button>
        )}
        <Button
          size="sm" variant="ghost"
          className="text-destructive hover:text-destructive ml-auto"
          onClick={onDelete} disabled={busy} aria-label={`Delete ${name}`}
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>

      {createdAt && (
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70 font-mono">
          Created {new Date(createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
        </span>
      )}
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Create dialog
// ─────────────────────────────────────────────────────────────────────────────

function CreateProjectDialog({
  open, onClose, onSubmit, isPending, error,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (input: { name: string; key: string; type: ProjectType; description: string }) => void;
  isPending: boolean;
  error: string | null;
}) {
  const [name,        setName]        = useState('');
  const [key,         setKey]         = useState('');
  const [type,        setType]        = useState<ProjectType>('KANBAN');
  const [description, setDescription] = useState('');
  const [keyTouched,  setKeyTouched]  = useState(false);

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) {
          onClose();
          setName(''); setKey(''); setType('KANBAN'); setDescription(''); setKeyTouched(false);
        }
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>New project</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit({
              name:        name.trim(),
              key:         key.trim().toUpperCase(),
              type,
              description: description.trim(),
            });
          }}
        >
          <DialogBody className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="proj-name" className="text-xs font-medium text-muted-foreground">Name</label>
              <Input
                id="proj-name" required autoFocus value={name}
                onChange={(e) => {
                  const v = e.target.value;
                  setName(v);
                  // Auto-derive the key while the user hasn't manually touched it.
                  if (!keyTouched) setKey(suggestKey(v));
                }}
                placeholder="e.g. Website Redesign"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="proj-key" className="text-xs font-medium text-muted-foreground">Key</label>
              <Input
                id="proj-key" required value={key}
                onChange={(e) => { setKey(e.target.value.toUpperCase()); setKeyTouched(true); }}
                maxLength={10}
                pattern="[A-Z][A-Z0-9]*"
                title="Uppercase letters and digits only; must start with a letter."
                placeholder="e.g. WEB"
                className="font-mono text-sm uppercase"
              />
              <span className="text-xs text-muted-foreground">
                Prefixes issue keys (<code className="font-mono">{key || 'WEB'}-123</code>). Uppercase letters and digits only.
              </span>
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
                        'flex flex-col items-center gap-1 rounded-md border px-2 py-3 transition-colors text-xs font-medium',
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
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="proj-desc" className="text-xs font-medium text-muted-foreground">Description (optional)</label>
              <textarea
                id="proj-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                placeholder="What is this project for?"
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
            <Button type="submit" variant="primary" disabled={isPending || !name.trim() || !key.trim()}>
              {isPending ? 'Creating…' : 'Create project'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// KPI / empty
// ─────────────────────────────────────────────────────────────────────────────

type KpiTone = 'default' | 'info' | 'success' | 'danger' | 'muted';

function KpiTile({
  icon: Icon, label, value, tone = 'default',
}: {
  icon: typeof Folder;
  label: string;
  value: number;
  tone?: KpiTone;
}) {
  const toneCls: Record<KpiTone, string> = {
    default: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
    info:    'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300',
    success: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
    danger:  'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300',
    muted:   'bg-muted text-muted-foreground',
  };
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2.5">
        <span className={cn('inline-flex size-9 items-center justify-center rounded-md', toneCls[tone])}>
          <Icon className="size-4" />
        </span>
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-wide text-muted-foreground truncate">{label}</div>
          <div className="text-xl font-semibold text-foreground tabular-nums">{value.toLocaleString()}</div>
        </div>
      </div>
    </Card>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border p-8 text-center">
      <Folder className="size-10 text-muted-foreground/50" aria-hidden="true" />
      <div className="space-y-1">
        <div className="text-sm font-medium text-foreground">No projects yet</div>
        <div className="text-xs text-muted-foreground max-w-md">
          Projects organise issues, sprints, workflows, and reports under a single key.
          Create one to start planning work.
        </div>
      </div>
      <Button size="sm" variant="primary" onClick={onCreate}>
        <Plus className="size-4" /> Create your first project
      </Button>
    </div>
  );
}
