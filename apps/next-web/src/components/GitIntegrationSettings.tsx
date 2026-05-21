'use client';

import { useEffect, useState, useTransition } from 'react';
import type { JSX } from 'react';
import {
  GitPullRequest, Plus, Trash2, Copy, Check, ExternalLink, Info,
} from 'lucide-react';

import type { GitConnection, GitProvider } from '@projectflow/types';

import {
  createGitConnection,
  deleteGitConnection,
  loadGitConnections,
} from '@/server/actions/git-connections';
import { notifyActionError } from '@/lib/apiErrorToast';
import { formatShortDateYear } from '@/lib/date';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody, DialogFooter,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

// ── Provider meta ────────────────────────────────────────────────────────────

const PROVIDER_LABELS: Record<GitProvider, string> = {
  github: 'GitHub',
  gitlab: 'GitLab',
};

// Brand SVG marks (kept inline from the old component — they're tiny and
// dependency-free, which lets us avoid an icon-pack just for two glyphs).
const PROVIDER_ICONS: Record<GitProvider, JSX.Element> = {
  github: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
    </svg>
  ),
  gitlab: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M22.65 14.39L12 22.13 1.35 14.39a.84.84 0 0 1-.3-.94l1.22-3.78 2.44-7.51A.42.42 0 0 1 4.82 2a.43.43 0 0 1 .58 0 .42.42 0 0 1 .11.18l2.44 7.49h8.1l2.44-7.51A.42.42 0 0 1 18.6 2a.43.43 0 0 1 .58 0 .42.42 0 0 1 .11.18l2.44 7.51 1.22 3.78a.84.84 0 0 1-.3.92z" />
    </svg>
  ),
};

const PROVIDER_DOCS: Record<GitProvider, string> = {
  github: 'https://docs.github.com/en/webhooks/using-webhooks/creating-webhooks',
  gitlab: 'https://docs.gitlab.com/ee/user/project/integrations/webhooks.html',
};

// ─────────────────────────────────────────────────────────────────────────────

interface Props { workspaceId: string }

export default function GitIntegrationSettings({ workspaceId }: Props) {
  const [connections, setConnections] = useState<GitConnection[] | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, startCreate] = useTransition();
  const [deleting, startDelete] = useTransition();

  const refetch = () => loadGitConnections(workspaceId).then(setConnections);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (workspaceId) refetch();
  }, [workspaceId]);

  const onCreate = (input: {
    provider: GitProvider; repoOwner: string; repoName: string; webhookSecret: string;
  }) => startCreate(async () => {
    setCreateError(null);
    const r = await createGitConnection(workspaceId, input);
    if (!r.ok) { setCreateError(r.error); notifyActionError(r); return; }
    setCreateOpen(false);
    await refetch();
  });

  const onDelete = (id: string) => startDelete(async () => {
    const r = await deleteGitConnection(id);
    if (!r.ok) return notifyActionError(r);
    await refetch();
  });

  const isLoading = connections === null;

  return (
    <div className="flex flex-col gap-3 h-full">
      {/* ── Intro / hero ───────────────────────────────────────────────────── */}
      <Card className="p-4">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-primary/10 p-2 text-primary shrink-0">
            <GitPullRequest className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-foreground">Connect a repository</h3>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
              Link GitHub or GitLab repos to this workspace. Once connected, PRs and commits that
              mention an issue key (e.g. <code className="font-mono text-foreground bg-muted/60 px-1 py-0.5 rounded">PF-42</code>) are
              auto-linked to the matching issue via webhooks.
            </p>
          </div>
          <Button size="sm" variant="primary" onClick={() => setCreateOpen(true)} className="shrink-0">
            <Plus className="size-4" /> Add repository
          </Button>
        </div>
      </Card>

      {/* ── Connections list ──────────────────────────────────────────────── */}
      {isLoading ? (
        <ListSkeleton />
      ) : !connections || connections.length === 0 ? (
        <EmptyState onCreate={() => setCreateOpen(true)} />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {connections.map((conn) => (
            <ConnectionCard
              key={conn.id}
              conn={conn}
              busy={deleting}
              onDelete={() => {
                if (window.confirm(`Disconnect ${conn.repoOwner}/${conn.repoName}?\n\nThis stops auto-linking PRs and commits for this repo. The webhook on the provider side will keep firing until you remove it there.`)) {
                  onDelete(conn.id);
                }
              }}
            />
          ))}
        </div>
      )}

      <CreateConnectionDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSubmit={onCreate}
        isPending={creating}
        error={createError}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Connection card
// ─────────────────────────────────────────────────────────────────────────────

function ConnectionCard({
  conn, onDelete, busy,
}: {
  conn: GitConnection;
  onDelete: () => void;
  busy: boolean;
}) {
  const repoUrl = conn.provider === 'github'
    ? `https://github.com/${conn.repoOwner}/${conn.repoName}`
    : `https://gitlab.com/${conn.repoOwner}/${conn.repoName}`;
  const connected = new Date(conn.createdAt);

  return (
    <Card className="p-4 flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <span className="inline-flex size-9 items-center justify-center rounded-md bg-muted text-foreground shrink-0">
          {PROVIDER_ICONS[conn.provider]}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 min-w-0">
            <a
              href={repoUrl}
              target="_blank" rel="noreferrer"
              className="text-sm font-semibold text-foreground hover:text-primary hover:underline truncate inline-flex items-center gap-1"
            >
              {conn.repoOwner}/{conn.repoName}
              <ExternalLink className="size-3 shrink-0 text-muted-foreground" />
            </a>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <Badge size="xs" variant="outline" appearance="outline" className="font-normal">
              {PROVIDER_LABELS[conn.provider]}
            </Badge>
            <span>
              Connected{' '}
              {Number.isFinite(connected.getTime())
                ? formatShortDateYear(connected)
                : '—'}
            </span>
            {!conn.webhookId && (
              <Badge size="xs" variant="outline" appearance="outline" className="bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                No webhook detected
              </Badge>
            )}
          </div>
        </div>
        <Button
          size="sm" variant="ghost"
          className="text-destructive hover:text-destructive shrink-0"
          onClick={onDelete}
          disabled={busy}
          aria-label={`Disconnect ${conn.repoOwner}/${conn.repoName}`}
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Create dialog
// ─────────────────────────────────────────────────────────────────────────────

function CreateConnectionDialog({
  open, onClose, onSubmit, isPending, error,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (input: {
    provider: GitProvider; repoOwner: string; repoName: string; webhookSecret: string;
  }) => void;
  isPending: boolean;
  error: string | null;
}) {
  const [provider,      setProvider]      = useState<GitProvider>('github');
  const [repoOwner,     setRepoOwner]     = useState('');
  const [repoName,      setRepoName]      = useState('');
  const [webhookSecret, setWebhookSecret] = useState('');

  // The full webhook URL is what the user has to paste into their repo
  // settings — surfacing it prominently with a copy button saves them
  // tab-hopping while wiring up the integration. (Display string only.)
  const webhookUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/api/v1/webhooks/${provider}`
    : `/api/v1/webhooks/${provider}`;

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) {
          onClose();
          setProvider('github'); setRepoOwner(''); setRepoName(''); setWebhookSecret('');
        }
      }}
    >
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Connect a repository</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit({
              provider,
              repoOwner: repoOwner.trim(),
              repoName:  repoName.trim(),
              webhookSecret,
            });
          }}
        >
          <DialogBody className="flex flex-col gap-4">
            {/* Provider tile picker */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">Provider</label>
              <div className="grid grid-cols-2 gap-2">
                {(['github', 'gitlab'] as GitProvider[]).map((p) => {
                  const active = provider === p;
                  return (
                    <button
                      key={p}
                      type="button"
                      className={cn(
                        'flex items-center gap-2 rounded-md border px-3 py-2.5 text-sm font-medium transition-colors',
                        active
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-border bg-card text-foreground hover:bg-muted/40',
                      )}
                      onClick={() => setProvider(p)}
                      aria-pressed={active}
                    >
                      {PROVIDER_ICONS[p]}
                      {PROVIDER_LABELS[p]}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Owner / repo */}
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="git-owner" className="text-xs font-medium text-muted-foreground">Owner / org</label>
                <Input
                  id="git-owner" required value={repoOwner} autoFocus
                  onChange={(e) => setRepoOwner(e.target.value)}
                  placeholder="acme-corp"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="git-repo" className="text-xs font-medium text-muted-foreground">Repository</label>
                <Input
                  id="git-repo" required value={repoName}
                  onChange={(e) => setRepoName(e.target.value)}
                  placeholder="my-app"
                />
              </div>
            </div>

            {/* Webhook URL with copy button */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">Webhook URL</label>
              <CopyField value={webhookUrl} />
              <span className="text-xs text-muted-foreground">
                Paste this URL into your repo's webhook settings.{' '}
                <a
                  href={PROVIDER_DOCS[provider]}
                  target="_blank" rel="noreferrer"
                  className="inline-flex items-center gap-0.5 text-primary hover:underline"
                >
                  {PROVIDER_LABELS[provider]} webhook docs
                  <ExternalLink className="size-3" />
                </a>
              </span>
            </div>

            {/* Webhook secret */}
            <div className="flex flex-col gap-1.5">
              <label htmlFor="git-secret" className="text-xs font-medium text-muted-foreground">Webhook secret</label>
              <Input
                id="git-secret" type="password" required minLength={8}
                value={webhookSecret}
                onChange={(e) => setWebhookSecret(e.target.value)}
                placeholder="At least 8 characters"
                autoComplete="new-password"
              />
              <span className="text-xs text-muted-foreground">
                Paste the same secret you'll enter on the provider side. Used to verify incoming webhook payloads.
              </span>
            </div>

            {/* Setup hint */}
            <div className="rounded-md border border-border bg-muted/40 px-3 py-2.5 text-xs text-muted-foreground leading-relaxed">
              <div className="flex items-center gap-1.5 mb-1 text-foreground font-medium">
                <Info className="size-3.5 text-primary" />
                Setup checklist
              </div>
              <ol className="list-decimal pl-5 space-y-0.5">
                <li>Subscribe to <strong>Pull request</strong> and <strong>Push</strong> events on the provider side.</li>
                <li>Set content type to <code className="font-mono">application/json</code>.</li>
                <li>Use the URL and secret above.</li>
              </ol>
            </div>

            {error && (
              <div className="rounded-md border-l-2 border-destructive bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {error}
              </div>
            )}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={isPending}>Cancel</Button>
            <Button
              type="submit"
              variant="primary"
              disabled={isPending || !repoOwner.trim() || !repoName.trim() || webhookSecret.length < 8}
            >
              {isPending ? 'Connecting…' : 'Connect repository'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Copy-to-clipboard field
// ─────────────────────────────────────────────────────────────────────────────

function CopyField({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be blocked in insecure contexts — fall back silently;
      // the user can still select the field manually.
    }
  };
  return (
    <div className="flex items-stretch gap-0 rounded-md border border-input bg-background overflow-hidden">
      <input
        readOnly
        value={value}
        onFocus={(e) => e.currentTarget.select()}
        className="flex-1 min-w-0 px-3 py-1.5 text-xs font-mono bg-transparent focus:outline-none"
        aria-label="Webhook URL"
      />
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="rounded-none border-l border-input shrink-0"
        onClick={copy}
        aria-label="Copy to clipboard"
      >
        {copied ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
      </Button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Empty / loading
// ─────────────────────────────────────────────────────────────────────────────

function ListSkeleton() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {[0, 1].map((i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
    </div>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border p-8 text-center">
      <GitPullRequest className="size-10 text-muted-foreground/50" aria-hidden="true" />
      <div className="space-y-1">
        <div className="text-sm font-medium text-foreground">No repositories connected</div>
        <div className="text-xs text-muted-foreground max-w-md">
          Connect a GitHub or GitLab repo so commits and pull requests that mention an issue key
          show up on the matching issue automatically.
        </div>
      </div>
      <Button size="sm" variant="primary" onClick={onCreate}>
        <Plus className="size-4" /> Connect repository
      </Button>
    </div>
  );
}
