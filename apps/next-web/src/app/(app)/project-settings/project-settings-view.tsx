'use client';

import { useMemo, useState, useTransition } from 'react';
import {
  Settings, Tag, Boxes, GitPullRequest, MessageSquare, Webhook,
  Plus, Trash2, Edit3, Search, Filter, ListChecks,
} from 'lucide-react';

import type { CustomField, Label, ProjectComponent } from '@projectflow/types';

import { notifyActionError } from '@/lib/apiErrorToast';
import { createLabel, updateLabel, deleteLabel } from '@/server/actions/labels';
import { createComponent, updateComponent, deleteComponent } from '@/server/actions/components';
import {
  WorkspaceProjectSwitcher,
} from '@/app/(app)/_components/selection-bridge';
import type { WorkspaceProjectContext } from '@/server/context';

import GitIntegrationSettings from '@/components/GitIntegrationSettings';
import SlackTeamsSettings     from '@/components/SlackTeamsSettings';
import WebhookManager         from '@/components/WebhookManager';
import { FieldManager }       from '@/components/custom-fields/FieldManager';

import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody, DialogFooter,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

// ─── Constants ───────────────────────────────────────────────────────────────

type Tab = 'labels' | 'components' | 'custom-fields' | 'git' | 'messaging' | 'webhooks';
const TABS: Array<{ value: Tab; label: string; icon: typeof Tag }> = [
  { value: 'labels',        label: 'Labels',          icon: Tag },
  { value: 'components',    label: 'Components',      icon: Boxes },
  { value: 'custom-fields', label: 'Custom Fields',   icon: ListChecks },
  { value: 'git',           label: 'Git Integration', icon: GitPullRequest },
  { value: 'messaging',  label: 'Slack & Teams',   icon: MessageSquare },
  { value: 'webhooks',   label: 'Webhooks',        icon: Webhook },
];

// Eight ~accessible label colours covering the common hue families.
const PRESET_COLORS = [
  '#6366f1', '#ec4899', '#10b981', '#f59e0b',
  '#0ea5e9', '#eab308', '#a855f7', '#94a3b8',
];

// ─────────────────────────────────────────────────────────────────────────────
// View
// ─────────────────────────────────────────────────────────────────────────────

interface Props {
  ctx:          WorkspaceProjectContext;
  labels:       Label[];
  components:   ProjectComponent[];
  customFields: CustomField[];
  initialTab:   string;
}

export function ProjectSettingsView({ ctx, labels, components, customFields, initialTab }: Props) {
  // Allow ?tab=git deep links (the sidebar uses /project-settings?tab=git). Seeded
  // once from the server-resolved searchParam, matching the original CSR behaviour.
  const isTab = (t: string): t is Tab => TABS.some((x) => x.value === t);
  const [tab, setTab] = useState<Tab>(isTab(initialTab) ? initialTab : 'labels');

  const activeProject = ctx.projects.find((p) => p.id === ctx.activeProjectId) ?? ctx.projects[0];
  const noProject = !ctx.activeProjectId;

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

      {noProject ? (
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
            <LabelsTab projectId={ctx.activeProjectId!} labels={labels} />
          </TabsContent>
          <TabsContent value="components" className="mt-3 flex-1 min-h-0">
            <ComponentsTab projectId={ctx.activeProjectId!} components={components} />
          </TabsContent>
          <TabsContent value="custom-fields" className="mt-3 flex-1 min-h-0">
            {/* Active Project == Space; custom fields are SPACE-scoped here. */}
            <FieldManager scopeType="SPACE" scopeId={ctx.activeProjectId!} fields={customFields} />
          </TabsContent>
          {/* Deferred to Phase 3: self-fetching integration components (still react-query + token). */}
          <TabsContent value="git" className="mt-3 flex-1 min-h-0">
            {ctx.activeWorkspaceId && <GitIntegrationSettings workspaceId={ctx.activeWorkspaceId} />}
          </TabsContent>
          <TabsContent value="messaging" className="mt-3 flex-1 min-h-0">
            {ctx.activeWorkspaceId && <SlackTeamsSettings workspaceId={ctx.activeWorkspaceId} />}
          </TabsContent>
          <TabsContent value="webhooks" className="mt-3 flex-1 min-h-0">
            {ctx.activeWorkspaceId && <WebhookManager workspaceId={ctx.activeWorkspaceId} />}
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

function LabelsTab({ projectId, labels }: { projectId: string; labels: Label[] }) {
  const [isPending, startTransition] = useTransition();

  const [search,     setSearch]     = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [editing,    setEditing]    = useState<Label | null>(null);
  const [saveError,  setSaveError]  = useState<string | null>(null);
  const [isSaving,   setIsSaving]   = useState(false);

  async function handleSave(input: { name: string; color: string }) {
    setSaveError(null);
    setIsSaving(true);
    try {
      const res = editing
        ? await updateLabel(editing.id, { name: input.name, color: input.color })
        : await createLabel({ projectId, name: input.name, color: input.color });
      if (!res.ok) {
        setSaveError(res.error);
        notifyActionError(res);
      } else {
        setCreateOpen(false);
        setEditing(null);
      }
    } finally {
      setIsSaving(false);
    }
  }

  function handleDelete(l: Label) {
    if (!window.confirm(`Delete label "${l.name}"?`)) return;
    startTransition(async () => {
      const res = await deleteLabel(l.id, projectId);
      if (!res.ok) notifyActionError(res);
    });
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return labels;
    return labels.filter((l) => l.name.toLowerCase().includes(q));
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
        <Button size="sm" variant="primary" onClick={() => { setSaveError(null); setCreateOpen(true); }}>
          <Plus className="size-4" /> New label
        </Button>
        <div className="ml-auto text-xs text-muted-foreground">
          <strong className="text-foreground">{filtered.length}</strong> of {labels.length}
        </div>
      </div>

      {labels.length === 0 ? (
        <EmptyTabState
          icon={Tag}
          title="No labels yet"
          body="Labels let you tag issues with quick visual markers — bug, frontend, customer-request, etc."
          ctaLabel="Create your first label"
          onCreate={() => { setSaveError(null); setCreateOpen(true); }}
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
                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => { setSaveError(null); setEditing(l); }} aria-label={`Edit ${l.name}`}>
                    <Edit3 className="size-3.5" />
                  </Button>
                  <Button
                    size="sm" variant="ghost"
                    className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                    onClick={() => handleDelete(l)}
                    disabled={isPending}
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
        onClose={() => { setCreateOpen(false); setSaveError(null); }}
        onSubmit={handleSave}
        isPending={isSaving}
        error={createOpen ? saveError : null}
      />
      <LabelDialog
        mode="edit"
        open={!!editing}
        initial={editing}
        onClose={() => { setEditing(null); setSaveError(null); }}
        onSubmit={handleSave}
        isPending={isSaving}
        error={editing ? saveError : null}
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

function ComponentsTab({ projectId, components }: { projectId: string; components: ProjectComponent[] }) {
  const [isPending, startTransition] = useTransition();

  const [search,     setSearch]     = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [editing,    setEditing]    = useState<ProjectComponent | null>(null);
  const [saveError,  setSaveError]  = useState<string | null>(null);
  const [isSaving,   setIsSaving]   = useState(false);

  async function handleSave(input: { name: string; description: string }) {
    setSaveError(null);
    setIsSaving(true);
    try {
      const description = input.description || null;
      const res = editing
        ? await updateComponent(editing.id, { name: input.name, description })
        : await createComponent({ projectId, name: input.name, description });
      if (!res.ok) {
        setSaveError(res.error);
        notifyActionError(res);
      } else {
        setCreateOpen(false);
        setEditing(null);
      }
    } finally {
      setIsSaving(false);
    }
  }

  function handleDelete(c: ProjectComponent) {
    if (!window.confirm(`Delete component "${c.name}"?`)) return;
    startTransition(async () => {
      const res = await deleteComponent(c.id, projectId);
      if (!res.ok) notifyActionError(res);
    });
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return components;
    return components.filter(
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
        <Button size="sm" variant="primary" onClick={() => { setSaveError(null); setCreateOpen(true); }}>
          <Plus className="size-4" /> New component
        </Button>
        <div className="ml-auto text-xs text-muted-foreground">
          <strong className="text-foreground">{filtered.length}</strong> of {components.length}
        </div>
      </div>

      {components.length === 0 ? (
        <EmptyTabState
          icon={Boxes}
          title="No components yet"
          body="Components let you split a project into functional areas — Frontend, Auth, Database — and optionally assign each one a lead."
          ctaLabel="Create your first component"
          onCreate={() => { setSaveError(null); setCreateOpen(true); }}
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
                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => { setSaveError(null); setEditing(c); }} aria-label="Edit">
                    <Edit3 className="size-3.5" />
                  </Button>
                  <Button
                    size="sm" variant="ghost"
                    className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                    onClick={() => handleDelete(c)}
                    disabled={isPending}
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
        onClose={() => { setCreateOpen(false); setSaveError(null); }}
        onSubmit={handleSave}
        isPending={isSaving}
        error={createOpen ? saveError : null}
      />
      <ComponentDialog
        mode="edit"
        open={!!editing}
        initial={editing}
        onClose={() => { setEditing(null); setSaveError(null); }}
        onSubmit={handleSave}
        isPending={isSaving}
        error={editing ? saveError : null}
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
// Shared empty states
// ─────────────────────────────────────────────────────────────────────────────

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
