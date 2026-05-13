'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Building2, Plus, Settings, Users, LayoutGrid, Shield,
} from 'lucide-react';

import { useStore } from '@/store/useStore';
import { notifyApiError } from '@/lib/apiErrorToast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody, DialogFooter,
} from '@/components/ui/dialog';

// Raw workspace row from the SP — PascalCase fields.
type ApiWorkspace = Record<string, any>;

async function api(path: string, token: string | null, init?: RequestInit) {
  const res = await fetch(`/api/v1${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization:  `Bearer ${token ?? ''}`,
      ...(init?.headers ?? {}),
    },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    notifyApiError(json, res.status);
    throw new Error(json?.error?.message ?? `Request failed (${res.status})`);
  }
  return json;
}

// Suggest a slug from a workspace name. Same shape as /setup so a workspace
// owner can predict the URL slug as they type the display name.
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

export default function WorkspacesPage() {
  const router      = useRouter();
  const qc          = useQueryClient();
  const accessToken = useStore((s) => s.accessToken);
  const currentUser = useStore((s) => s.user) as { Id?: string } | null;

  const [createOpen, setCreateOpen] = useState(false);

  const { data: workspaces, isLoading } = useQuery<ApiWorkspace[]>({
    queryKey: ['workspaces', accessToken],
    queryFn: async () => {
      const json = await api('/workspaces', accessToken);
      return json.data ?? [];
    },
  });

  const createMutation = useMutation({
    mutationFn: ({ name, slug }: { name: string; slug: string }) =>
      api('/workspaces', accessToken, { method: 'POST', body: JSON.stringify({ name, slug }) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['workspaces'] });
      setCreateOpen(false);
    },
  });

  return (
    <div className="flex h-full flex-col gap-4">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3">
        <div className="rounded-lg bg-primary/10 p-2 text-primary">
          <Building2 className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-xs text-muted-foreground">System</div>
          <h2 className="text-base font-semibold text-foreground truncate">Workspaces</h2>
        </div>
        <Button size="sm" variant="primary" onClick={() => setCreateOpen(true)}>
          <Plus className="size-4" /> New workspace
        </Button>
      </div>

      {/* ── Body ───────────────────────────────────────────────────────────── */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-32 rounded-xl" />)}
        </div>
      ) : !workspaces || workspaces.length === 0 ? (
        <EmptyState onCreate={() => setCreateOpen(true)} />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {workspaces.map((ws) => {
            const id   = String(ws.Id ?? ws.id);
            const name = ws.Name ?? ws.name ?? '(unnamed)';
            const slug = ws.Slug ?? ws.slug ?? '';
            return (
              <Card key={id} className="p-4 flex flex-col gap-3 hover:border-primary/30 transition-colors">
                <div className="flex items-start gap-3 min-w-0">
                  <div className="rounded-md bg-muted p-2 text-muted-foreground shrink-0">
                    <Building2 className="size-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-foreground truncate">{name}</div>
                    <div className="text-xs text-muted-foreground font-mono truncate">{slug}</div>
                  </div>
                  {currentUser?.Id && String(ws.OwnerId).toLowerCase() === String(currentUser.Id).toLowerCase() && (
                    <Badge variant="outline" size="xs" appearance="outline" className="gap-1">
                      <Shield className="size-3" /> Owner
                    </Badge>
                  )}
                </div>

                <div className="mt-auto flex flex-wrap gap-1.5">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => router.push('/board')}
                  >
                    <LayoutGrid className="size-3.5" /> Open board
                  </Button>
                  <Link href={`/workspaces/${id}/members`}>
                    <Button size="sm" variant="ghost"><Users className="size-3.5" /> Members</Button>
                  </Link>
                  <Link href={`/workspaces/${id}/settings`}>
                    <Button size="sm" variant="ghost"><Settings className="size-3.5" /> Settings</Button>
                  </Link>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <CreateWorkspaceDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSubmit={(input) => createMutation.mutate(input)}
        isPending={createMutation.isPending}
        error={(createMutation.error as Error | null)?.message ?? null}
      />
    </div>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border p-8 text-center">
      <Building2 className="size-10 text-muted-foreground/50" aria-hidden="true" />
      <div className="space-y-1">
        <div className="text-sm font-medium text-foreground">No workspaces yet</div>
        <div className="text-xs text-muted-foreground max-w-sm">
          A workspace is a top-level container for projects, members, and settings.
          Create one to get started.
        </div>
      </div>
      <Button size="sm" variant="primary" onClick={onCreate}>
        <Plus className="size-4" /> Create workspace
      </Button>
    </div>
  );
}

function CreateWorkspaceDialog({
  open, onClose, onSubmit, isPending, error,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (input: { name: string; slug: string }) => void;
  isPending: boolean;
  error: string | null;
}) {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  // Track whether the user has manually edited slug — once they have, we
  // stop auto-following the name field so we don't surprise them.
  const [slugTouched, setSlugTouched] = useState(false);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { onClose(); setName(''); setSlug(''); setSlugTouched(false); } }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New workspace</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const finalSlug = slug.trim() || slugify(name);
            onSubmit({ name: name.trim(), slug: finalSlug });
          }}
        >
          <DialogBody className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="ws-name" className="text-xs font-medium text-muted-foreground">Name</label>
              <Input
                id="ws-name"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (!slugTouched) setSlug(slugify(e.target.value));
                }}
                placeholder="Acme Corp"
                required
                autoFocus
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="ws-slug" className="text-xs font-medium text-muted-foreground">URL slug</label>
              <Input
                id="ws-slug"
                value={slug}
                onChange={(e) => { setSlug(e.target.value); setSlugTouched(true); }}
                placeholder="acme-corp"
                pattern="[a-z0-9-]+"
                title="Lowercase letters, numbers, and dashes only"
                required
                className="font-mono text-sm"
              />
              <span className="text-xs text-muted-foreground">
                Used in URLs. Lowercase letters, numbers, and dashes only.
              </span>
            </div>
            {error && (
              <div className="rounded-md border-l-2 border-destructive bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {error}
              </div>
            )}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={isPending}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={isPending || !name.trim() || !slug.trim()}>
              {isPending ? 'Creating…' : 'Create workspace'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
