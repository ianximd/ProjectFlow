'use client';

import { useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { Building2, ArrowLeft, Save, Trash2, AlertTriangle } from 'lucide-react';

import { notifyActionError } from '@/lib/apiErrorToast';
import { updateWorkspace, deleteWorkspace } from '@/server/actions/workspaces';
import type { WorkspaceDetail } from '@/server/queries/workspace';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';

export function WorkspaceSettingsView({ workspace }: { workspace: WorkspaceDetail }) {
  const [isPending, startTransition] = useTransition();

  const [name,      setName]      = useState(workspace.name);
  const [slug,      setSlug]      = useState(workspace.slug);
  const [avatarUrl, setAvatarUrl] = useState(workspace.avatarUrl ?? '');
  const [saveError, setSaveError] = useState<string | null>(null);

  // Re-seed the form if the workspace prop changes (e.g. after a revalidation).
  useEffect(() => {
    setName(workspace.name);
    setSlug(workspace.slug);
    setAvatarUrl(workspace.avatarUrl ?? '');
  }, [workspace.name, workspace.slug, workspace.avatarUrl]);

  const dirty =
    name !== workspace.name ||
    slug !== workspace.slug ||
    avatarUrl !== (workspace.avatarUrl ?? '');

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaveError(null);
    const changed: { name?: string; slug?: string; avatarUrl?: string | null } = {};
    if (name !== workspace.name)             changed.name = name;
    if (slug !== workspace.slug)             changed.slug = slug;
    if (avatarUrl !== (workspace.avatarUrl ?? '')) changed.avatarUrl = avatarUrl || null;
    startTransition(async () => {
      const res = await updateWorkspace(workspace.id, changed);
      if (!res.ok) {
        setSaveError(res.error);
        notifyActionError(res);
      }
    });
  }

  function handleDiscard() {
    setName(workspace.name);
    setSlug(workspace.slug);
    setAvatarUrl(workspace.avatarUrl ?? '');
    setSaveError(null);
  }

  return (
    <div className="flex h-full flex-col gap-4 max-w-3xl">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3">
        <Link href="/workspaces" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" />
        </Link>
        <div className="rounded-lg bg-primary/10 p-2 text-primary">
          <Building2 className="size-5" />
        </div>
        <div className="min-w-0">
          <div className="text-xs text-muted-foreground">Workspace settings</div>
          <h2 className="text-base font-semibold text-foreground truncate">
            {workspace.name || 'Workspace'}
          </h2>
        </div>
      </div>

      {/* ── General ──────────────────────────────────────────────────────── */}
      <Card className="p-5">
        <h3 className="text-sm font-semibold text-foreground mb-4">General</h3>
        <form onSubmit={handleSave} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="ws-name" className="text-xs font-medium text-muted-foreground">Name</label>
            <Input id="ws-name" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="ws-slug" className="text-xs font-medium text-muted-foreground">URL slug</label>
            <Input
              id="ws-slug"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              pattern="[a-z0-9-]+"
              title="Lowercase letters, numbers, and dashes only"
              required
              className="font-mono text-sm"
            />
            <span className="text-xs text-muted-foreground">
              Changing the slug will break any URLs that already reference it.
            </span>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="ws-avatar" className="text-xs font-medium text-muted-foreground">
              Avatar URL (optional)
            </label>
            <Input
              id="ws-avatar"
              type="url"
              value={avatarUrl}
              onChange={(e) => setAvatarUrl(e.target.value)}
              placeholder="https://…/logo.png"
            />
          </div>

          {saveError && (
            <div className="rounded-md border-l-2 border-destructive bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {saveError}
            </div>
          )}

          <div className="flex items-center gap-2">
            <Button type="submit" variant="primary" disabled={!dirty || isPending}>
              <Save className="size-4" />
              {isPending ? 'Saving…' : 'Save changes'}
            </Button>
            {dirty && (
              <Button type="button" variant="ghost" onClick={handleDiscard} disabled={isPending}>
                Discard
              </Button>
            )}
          </div>
        </form>
      </Card>

      {/* ── Danger zone ──────────────────────────────────────────────────── */}
      <Card className="p-5 border-destructive/40">
        <div className="flex items-center gap-2 mb-3">
          <AlertTriangle className="size-4 text-destructive" />
          <h3 className="text-sm font-semibold text-destructive">Danger zone</h3>
        </div>
        <DeleteWorkspacePanel
          workspaceId={workspace.id}
          expectedSlug={workspace.slug}
        />
      </Card>
    </div>
  );
}

// ── Delete confirmation panel ─────────────────────────────────────────────────

function DeleteWorkspacePanel({
  workspaceId,
  expectedSlug,
}: {
  workspaceId: string;
  expectedSlug: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [confirmInput, setConfirmInput] = useState('');
  const [deleteError,  setDeleteError]  = useState<string | null>(null);

  const matches = confirmInput.trim() === expectedSlug;

  function handleDelete() {
    setDeleteError(null);
    startTransition(async () => {
      const res = await deleteWorkspace(workspaceId);
      // deleteWorkspace redirects on success; this branch is only reached on failure.
      if (!res.ok) {
        setDeleteError(res.error);
        notifyActionError(res);
      }
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Deleting a workspace removes all of its projects, members, and history.
        This action cannot be undone.
      </p>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="ws-confirm" className="text-xs font-medium text-muted-foreground">
          Type <code className="font-mono text-foreground">{expectedSlug}</code> to confirm
        </label>
        <Input
          id="ws-confirm"
          value={confirmInput}
          onChange={(e) => setConfirmInput(e.target.value)}
          className="font-mono text-sm max-w-sm"
          autoComplete="off"
        />
      </div>
      {deleteError && (
        <div className="rounded-md border-l-2 border-destructive bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {deleteError}
        </div>
      )}
      <div>
        <Button
          variant="destructive"
          onClick={handleDelete}
          disabled={!matches || isPending}
        >
          <Trash2 className="size-4" />
          {isPending ? 'Deleting…' : 'Delete workspace'}
        </Button>
      </div>
    </div>
  );
}
