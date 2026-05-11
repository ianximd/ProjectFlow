'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Building2, ArrowLeft, Save, Trash2, AlertTriangle } from 'lucide-react';

import { useStore } from '@/store/useStore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

async function api(path: string, token: string | null, init?: RequestInit) {
  const res = await fetch(`/api/v1${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization:  `Bearer ${token ?? ''}`,
      ...(init?.headers ?? {}),
    },
  });
  // 204 No Content has no body to parse.
  if (res.status === 204) return {};
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error?.message ?? `Request failed (${res.status})`);
  return json;
}

export default function WorkspaceSettingsPage() {
  const params      = useParams<{ id: string }>();
  const router      = useRouter();
  const qc          = useQueryClient();
  const accessToken = useStore((s) => s.accessToken);
  const workspaceId = params.id;

  const { data: ws, isLoading } = useQuery<Record<string, any>>({
    queryKey: ['workspace', workspaceId],
    enabled: !!workspaceId,
    queryFn: async () => (await api(`/workspaces/${workspaceId}`, accessToken)).data,
  });

  const [name,      setName]      = useState('');
  const [slug,      setSlug]      = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');

  // Re-seed the form whenever the upstream row changes (initial load OR after
  // a successful save).
  useEffect(() => {
    if (!ws) return;
    setName(ws.Name ?? '');
    setSlug(ws.Slug ?? '');
    setAvatarUrl(ws.AvatarUrl ?? '');
  }, [ws]);

  const updateMutation = useMutation({
    mutationFn: (input: { name?: string; slug?: string; avatarUrl?: string | null }) =>
      api(`/workspaces/${workspaceId}`, accessToken, {
        method: 'PATCH', body: JSON.stringify(input),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['workspace', workspaceId] });
      qc.invalidateQueries({ queryKey: ['workspaces'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () =>
      api(`/workspaces/${workspaceId}`, accessToken, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['workspaces'] });
      router.push('/workspaces');
    },
  });

  const dirty =
    !!ws && (name !== (ws.Name ?? '')
          || slug !== (ws.Slug ?? '')
          || avatarUrl !== (ws.AvatarUrl ?? ''));

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
            {ws?.Name ?? (isLoading ? 'Loading…' : 'Workspace')}
          </h2>
        </div>
      </div>

      {isLoading ? (
        <Skeleton className="h-64 rounded-xl" />
      ) : !ws ? (
        <Card className="p-6 text-center text-sm text-muted-foreground">
          Workspace not found or you no longer have access.
        </Card>
      ) : (
        <>
          {/* ── General ──────────────────────────────────────────────────── */}
          <Card className="p-5">
            <h3 className="text-sm font-semibold text-foreground mb-4">General</h3>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                updateMutation.mutate({
                  // PATCH semantics: only send the fields that actually
                  // changed so a no-op save doesn't churn the row.
                  ...(name !== (ws.Name ?? '')             ? { name } : {}),
                  ...(slug !== (ws.Slug ?? '')             ? { slug } : {}),
                  ...(avatarUrl !== (ws.AvatarUrl ?? '')   ? { avatarUrl: avatarUrl || null } : {}),
                });
              }}
              className="flex flex-col gap-4"
            >
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
                <label htmlFor="ws-avatar" className="text-xs font-medium text-muted-foreground">Avatar URL (optional)</label>
                <Input
                  id="ws-avatar"
                  type="url"
                  value={avatarUrl}
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
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      setName(ws.Name ?? ''); setSlug(ws.Slug ?? ''); setAvatarUrl(ws.AvatarUrl ?? '');
                    }}
                  >
                    Discard
                  </Button>
                )}
              </div>
            </form>
          </Card>

          {/* ── Danger zone ──────────────────────────────────────────────── */}
          <Card className="p-5 border-destructive/40">
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle className="size-4 text-destructive" />
              <h3 className="text-sm font-semibold text-destructive">Danger zone</h3>
            </div>
            <DeleteWorkspacePanel
              expectedSlug={ws.Slug ?? ''}
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

// Type-the-slug-to-confirm pattern. Copies GitHub's repo-delete UX so an
// owner can't accidentally one-click destroy a whole workspace.
function DeleteWorkspacePanel({
  expectedSlug, onConfirm, isPending, error,
}: {
  expectedSlug: string;
  onConfirm: () => void;
  isPending: boolean;
  error: string | null;
}) {
  const [confirmInput, setConfirmInput] = useState('');
  const matches = confirmInput.trim() === expectedSlug;

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
      {error && (
        <div className="rounded-md border-l-2 border-destructive bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}
      <div>
        <Button variant="destructive" onClick={onConfirm} disabled={!matches || isPending}>
          <Trash2 className="size-4" />
          {isPending ? 'Deleting…' : 'Delete workspace'}
        </Button>
      </div>
    </div>
  );
}
