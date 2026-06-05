'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  Building2, Plus, Settings, Users, LayoutGrid, Shield,
} from 'lucide-react';

import { notifyActionError } from '@/lib/apiErrorToast';
import { createWorkspace } from '@/server/actions/workspaces';
import type { WorkspaceListItem } from '@/server/queries/workspaces';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody, DialogFooter,
} from '@/components/ui/dialog';

// Suggest a slug from a workspace name. Same shape as /setup so a workspace
// owner can predict the URL slug as they type the display name.
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

interface Props {
  workspaces:    WorkspaceListItem[];
  currentUserId: string;
}

export function WorkspacesView({ workspaces, currentUserId }: Props) {
  const t = useTranslations('Workspaces');
  const router = useRouter();
  const [createOpen, setCreateOpen] = useState(false);
  const [saveError,  setSaveError]  = useState<string | null>(null);
  const [isSaving,   setIsSaving]   = useState(false);

  async function handleCreate(input: { name: string; slug: string }) {
    setSaveError(null);
    setIsSaving(true);
    try {
      const res = await createWorkspace(input.name, input.slug);
      if (!res.ok) {
        setSaveError(res.error);
        notifyActionError(res);
      } else {
        setCreateOpen(false);
      }
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="flex h-full flex-col gap-4">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3">
        <div className="rounded-lg bg-primary/10 p-2 text-primary">
          <Building2 className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-xs text-muted-foreground">{t('system')}</div>
          <h2 className="text-base font-semibold text-foreground truncate">{t('heading')}</h2>
        </div>
        <Button size="sm" variant="primary" onClick={() => { setSaveError(null); setCreateOpen(true); }}>
          <Plus className="size-4" /> {t('newWorkspace')}
        </Button>
      </div>

      {/* ── Body ───────────────────────────────────────────────────────────── */}
      {workspaces.length === 0 ? (
        <EmptyState onCreate={() => { setSaveError(null); setCreateOpen(true); }} />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {workspaces.map((ws) => {
            const isOwner =
              !!ws.ownerId && !!currentUserId &&
              ws.ownerId.toLowerCase() === currentUserId.toLowerCase();
            return (
              <Card key={ws.id} className="p-4 flex flex-col gap-3 hover:border-primary/30 transition-colors">
                <div className="flex items-start gap-3 min-w-0">
                  <div className="rounded-md bg-muted p-2 text-muted-foreground shrink-0">
                    <Building2 className="size-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-foreground truncate">{ws.name}</div>
                    <div className="text-xs text-muted-foreground font-mono truncate">{ws.slug}</div>
                  </div>
                  {isOwner && (
                    <Badge variant="outline" size="xs" appearance="outline" className="gap-1">
                      <Shield className="size-3" /> {t('ownerBadge')}
                    </Badge>
                  )}
                </div>

                <div className="mt-auto flex flex-wrap gap-1.5">
                  <Button size="sm" variant="outline" onClick={() => router.push('/board')}>
                    <LayoutGrid className="size-3.5" /> {t('openBoard')}
                  </Button>
                  <Link href={`/workspaces/${ws.id}/members`}>
                    <Button size="sm" variant="ghost"><Users className="size-3.5" /> {t('membersLink')}</Button>
                  </Link>
                  <Link href={`/workspaces/${ws.id}/settings`}>
                    <Button size="sm" variant="ghost"><Settings className="size-3.5" /> {t('settingsLink')}</Button>
                  </Link>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <CreateWorkspaceDialog
        open={createOpen}
        onClose={() => { setCreateOpen(false); setSaveError(null); }}
        onSubmit={handleCreate}
        isPending={isSaving}
        error={saveError}
      />
    </div>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  const t = useTranslations('Workspaces');
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border p-8 text-center">
      <Building2 className="size-10 text-muted-foreground/50" aria-hidden="true" />
      <div className="space-y-1">
        <div className="text-sm font-medium text-foreground">{t('emptyTitle')}</div>
        <div className="text-xs text-muted-foreground max-w-sm">
          {t('emptyBody')}
        </div>
      </div>
      <Button size="sm" variant="primary" onClick={onCreate}>
        <Plus className="size-4" /> {t('emptyCreate')}
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
  const t = useTranslations('Workspaces');
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  // Track whether the user has manually edited slug — once they have, we
  // stop auto-following the name field so we don't surprise them.
  const [slugTouched, setSlugTouched] = useState(false);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { onClose(); setName(''); setSlug(''); setSlugTouched(false); } }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('dialogTitle')}</DialogTitle>
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
              <label htmlFor="ws-name" className="text-xs font-medium text-muted-foreground">{t('dialogNameLabel')}</label>
              <Input
                id="ws-name"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (!slugTouched) setSlug(slugify(e.target.value));
                }}
                placeholder={t('dialogNamePlaceholder')}
                required
                autoFocus
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="ws-slug" className="text-xs font-medium text-muted-foreground">{t('dialogSlugLabel')}</label>
              <Input
                id="ws-slug"
                value={slug}
                onChange={(e) => { setSlug(e.target.value); setSlugTouched(true); }}
                placeholder={t('dialogSlugPlaceholder')}
                pattern="[a-z0-9\-]+"
                title={t('dialogSlugTitle')}
                required
                className="font-mono text-sm"
              />
              <span className="text-xs text-muted-foreground">
                {t('dialogSlugHint')}
              </span>
            </div>
            {error && (
              <div className="rounded-md border-l-2 border-destructive bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {error}
              </div>
            )}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={isPending}>{t('dialogCancel')}</Button>
            <Button type="submit" variant="primary" disabled={isPending || !name.trim() || !slug.trim()}>
              {isPending ? t('dialogCreating') : t('dialogCreate')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
