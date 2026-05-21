'use client';

import { useEffect, useState, useTransition } from 'react';
import type { JSX } from 'react';
import {
  MessageSquare, Plus, Trash2, ExternalLink, Send, CheckCircle2, AlertTriangle, Info,
} from 'lucide-react';

import type {
  IntegrationConnection,
  IntegrationEvent,
  IntegrationProvider,
} from '@projectflow/types';

import {
  createIntegration,
  deleteIntegration,
  testIntegrationDelivery,
  loadIntegrations,
} from '@/server/actions/integrations';
import { notifyActionError } from '@/lib/apiErrorToast';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody, DialogFooter,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

// ── Constants ────────────────────────────────────────────────────────────────

const ALL_EVENTS: { value: IntegrationEvent; label: string; description: string }[] = [
  { value: 'task.created',      label: 'Task created',      description: 'A new issue is created in any project of this workspace' },
  { value: 'task.transitioned', label: 'Task transitioned', description: 'An issue moves between workflow statuses' },
  { value: 'sprint.started',    label: 'Sprint started',    description: 'A sprint enters the ACTIVE state' },
  { value: 'sprint.completed',  label: 'Sprint completed',  description: 'A sprint is closed out' },
];
const DEFAULT_EVENTS: IntegrationEvent[] = ALL_EVENTS.map((e) => e.value);

const PROVIDER_LABELS: Record<IntegrationProvider, string> = {
  slack:   'Slack',
  msteams: 'Microsoft Teams',
};

// Brand SVG marks (kept inline — dependency-free, easier than pulling in a
// brand icon library for just two glyphs).
const PROVIDER_ICONS: Record<IntegrationProvider, JSX.Element> = {
  slack: (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#E01E5A" d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.522h2.52v2.522zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.522 2.527 2.527 0 0 1 2.521 2.522v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313z"/>
      <path fill="#36C5F0" d="M8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312z"/>
      <path fill="#2EB67D" d="M18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312z"/>
      <path fill="#ECB22E" d="M15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z"/>
    </svg>
  ),
  msteams: (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#5059C9" d="M14.5 9h6.42c.598 0 1.08.483 1.08 1.08v5.95c0 2.198-1.782 3.97-3.98 3.97h-.02c-2.198 0-3.98-1.772-3.98-3.97v-7.03h.48zM19.5 8.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z"/>
      <path fill="#7B83EB" d="M11.5 9h7.5v7c0 2.485-2.015 4.5-4.5 4.5S10 18.485 10 16V10.5C10 9.672 10.672 9 11.5 9zM14 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"/>
      <path fill="#4B53BC" d="M2 6.5h12V18a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 18V6.5z"/>
      <path fill="#fff" d="M5.32 9.5h5.36v1.25H8.65v5h-1.3v-5H5.32V9.5z"/>
    </svg>
  ),
};

const PROVIDER_PLACEHOLDER: Record<IntegrationProvider, { channel: string; url: string }> = {
  slack:   { channel: '#dev-alerts',         url: 'https://hooks.slack.com/services/T…/B…/…' },
  msteams: { channel: 'Dev Alerts channel',  url: 'https://outlook.office.com/webhook/…' },
};

const PROVIDER_DOCS: Record<IntegrationProvider, string> = {
  slack:   'https://api.slack.com/messaging/webhooks',
  msteams: 'https://learn.microsoft.com/en-us/microsoftteams/platform/webhooks-and-connectors/how-to/add-incoming-webhook',
};

// ─────────────────────────────────────────────────────────────────────────────

interface Props { workspaceId: string }

export default function SlackTeamsSettings({ workspaceId }: Props) {
  const [connections, setConnections] = useState<IntegrationConnection[] | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, startCreate] = useTransition();
  const [deleting, startDelete] = useTransition();

  const refetch = () => loadIntegrations(workspaceId).then(setConnections);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (workspaceId) refetch();
  }, [workspaceId]);

  const onCreate = (input: {
    provider: IntegrationProvider; channelName: string; webhookUrl: string; events: IntegrationEvent[];
  }) => startCreate(async () => {
    setCreateError(null);
    const r = await createIntegration(workspaceId, input);
    if (!r.ok) { setCreateError(r.error); notifyActionError(r); return; }
    setCreateOpen(false);
    await refetch();
  });

  const onDelete = (id: string) => startDelete(async () => {
    const r = await deleteIntegration(id);
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
            <MessageSquare className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-foreground">Notify Slack &amp; Teams channels</h3>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
              Send a message to a channel whenever an issue is created or transitioned, or when a sprint
              starts or completes. Paste an <strong>Incoming Webhook URL</strong> from your Slack app or
              Teams connector.
            </p>
          </div>
          <Button size="sm" variant="primary" onClick={() => setCreateOpen(true)} className="shrink-0">
            <Plus className="size-4" /> Add connection
          </Button>
        </div>
      </Card>

      {/* ── Connection list ──────────────────────────────────────────────── */}
      {isLoading ? (
        <ListSkeleton />
      ) : !connections || connections.length === 0 ? (
        <EmptyState onCreate={() => setCreateOpen(true)} />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {connections.map((c) => (
            <ConnectionCard
              key={c.id}
              conn={c}
              busy={deleting}
              onDelete={() => {
                if (window.confirm(`Remove the connection for ${c.channelName}?\n\nMessages will stop being sent. You can re-add the same webhook URL later.`)) {
                  onDelete(c.id);
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
  conn: IntegrationConnection;
  onDelete: () => void;
  busy: boolean;
}) {
  const created = new Date(conn.createdAt);
  return (
    <Card className={cn('p-4 flex flex-col gap-3', !conn.isActive && 'opacity-70')}>
      <div className="flex items-start gap-3">
        <span className="inline-flex size-9 items-center justify-center rounded-md bg-muted text-foreground shrink-0">
          {PROVIDER_ICONS[conn.provider]}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap min-w-0">
            <h3 className="text-sm font-semibold text-foreground truncate">{conn.channelName}</h3>
            {!conn.isActive && (
              <Badge size="xs" variant="outline" appearance="outline" className="bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                Inactive
              </Badge>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <Badge size="xs" variant="outline" appearance="outline" className="font-normal">
              {PROVIDER_LABELS[conn.provider]}
            </Badge>
            <span>
              Added{' '}
              {Number.isFinite(created.getTime())
                ? created.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
                : '—'}
            </span>
          </div>
        </div>
        <Button
          size="sm" variant="ghost"
          className="text-destructive hover:text-destructive shrink-0"
          onClick={onDelete}
          disabled={busy}
          aria-label={`Remove ${conn.channelName}`}
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>

      {/* Subscribed events as chips */}
      <div className="flex flex-wrap gap-1.5">
        {ALL_EVENTS.map((e) => {
          const enabled = conn.events.includes(e.value);
          return (
            <Badge
              key={e.value}
              size="xs"
              variant="outline"
              appearance="outline"
              className={cn(
                'font-normal gap-1',
                enabled
                  ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 border-emerald-200 dark:border-emerald-900'
                  : 'opacity-50',
              )}
            >
              <span className={cn('inline-block size-1.5 rounded-full', enabled ? 'bg-emerald-500' : 'bg-muted-foreground/40')} />
              {e.label}
            </Badge>
          );
        })}
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
    provider: IntegrationProvider; channelName: string; webhookUrl: string; events: IntegrationEvent[];
  }) => void;
  isPending: boolean;
  error: string | null;
}) {
  const [provider,    setProvider]    = useState<IntegrationProvider>('slack');
  const [channelName, setChannelName] = useState('');
  const [webhookUrl,  setWebhookUrl]  = useState('');
  const [events,      setEvents]      = useState<IntegrationEvent[]>([...DEFAULT_EVENTS]);

  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'ok' | 'err'>('idle');
  const [testError,  setTestError]  = useState('');

  const toggleEvent = (ev: IntegrationEvent) =>
    setEvents((prev) => prev.includes(ev) ? prev.filter((e) => e !== ev) : [...prev, ev]);

  const handleTest = async () => {
    if (!webhookUrl) return;
    setTestStatus('testing'); setTestError('');
    const r = await testIntegrationDelivery({ provider, webhookUrl });
    if (r.ok) setTestStatus('ok');
    else      { setTestStatus('err'); setTestError(r.error); }
  };

  const placeholder = PROVIDER_PLACEHOLDER[provider];
  const canSubmit   = channelName.trim() && webhookUrl.trim() && events.length > 0 && !isPending;

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) {
          onClose();
          setProvider('slack'); setChannelName(''); setWebhookUrl('');
          setEvents([...DEFAULT_EVENTS]); setTestStatus('idle'); setTestError('');
        }
      }}
    >
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>New integration</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit({ provider, channelName: channelName.trim(), webhookUrl: webhookUrl.trim(), events });
          }}
        >
          <DialogBody className="flex flex-col gap-4 max-h-[60vh] overflow-y-auto">
            {/* Provider tiles */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">Platform</label>
              <div className="grid grid-cols-2 gap-2">
                {(['slack', 'msteams'] as IntegrationProvider[]).map((p) => {
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
                      onClick={() => { setProvider(p); setTestStatus('idle'); setTestError(''); }}
                      aria-pressed={active}
                    >
                      {PROVIDER_ICONS[p]}
                      {PROVIDER_LABELS[p]}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Channel + webhook URL */}
            <div className="flex flex-col gap-1.5">
              <label htmlFor="slk-channel" className="text-xs font-medium text-muted-foreground">Channel label</label>
              <Input
                id="slk-channel" required value={channelName} autoFocus
                onChange={(e) => setChannelName(e.target.value)}
                placeholder={placeholder.channel}
              />
              <span className="text-xs text-muted-foreground">A friendly name — shown in the connection list. The actual destination is decided by the webhook URL.</span>
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="slk-url" className="text-xs font-medium text-muted-foreground">Incoming webhook URL</label>
              <Input
                id="slk-url" type="url" required
                value={webhookUrl}
                onChange={(e) => { setWebhookUrl(e.target.value); setTestStatus('idle'); setTestError(''); }}
                placeholder={placeholder.url}
                autoComplete="off"
                className="font-mono text-xs"
              />
              <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
                Need help?{' '}
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

            {/* Test delivery */}
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2">
              <Button
                type="button" size="sm" variant="outline"
                onClick={handleTest}
                disabled={!webhookUrl || testStatus === 'testing'}
              >
                <Send className="size-3.5" />
                {testStatus === 'testing' ? 'Sending…' : 'Send test message'}
              </Button>
              {testStatus === 'ok' && (
                <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                  <CheckCircle2 className="size-3.5" /> Delivered
                </span>
              )}
              {testStatus === 'err' && (
                <span className="inline-flex items-center gap-1 text-xs font-medium text-destructive">
                  <AlertTriangle className="size-3.5" /> {testError}
                </span>
              )}
              <span className="ml-auto text-xs text-muted-foreground">
                Sends a one-line "Hello from ProjectFlow" to the URL above.
              </span>
            </div>

            {/* Event subscriptions */}
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-muted-foreground">Notify on events</label>
                <div className="flex items-center gap-2 text-xs">
                  <button
                    type="button"
                    className="text-primary hover:underline"
                    onClick={() => setEvents([...DEFAULT_EVENTS])}
                  >All</button>
                  <span className="text-muted-foreground">·</span>
                  <button
                    type="button"
                    className="text-primary hover:underline"
                    onClick={() => setEvents([])}
                  >None</button>
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                {ALL_EVENTS.map((e) => {
                  const enabled = events.includes(e.value);
                  return (
                    <label
                      key={e.value}
                      className={cn(
                        'flex items-start gap-2.5 rounded-md border px-3 py-2 cursor-pointer transition-colors',
                        enabled ? 'border-primary/40 bg-primary/5' : 'border-border bg-card hover:bg-muted/30',
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={enabled}
                        onChange={() => toggleEvent(e.value)}
                        className="mt-1 size-3.5 accent-primary"
                      />
                      <div className="flex flex-col">
                        <span className="text-sm font-medium text-foreground">{e.label}</span>
                        <span className="text-xs text-muted-foreground">{e.description}</span>
                      </div>
                    </label>
                  );
                })}
              </div>
              {events.length === 0 && (
                <div className="text-xs text-amber-700 dark:text-amber-300 inline-flex items-center gap-1">
                  <Info className="size-3.5" /> Pick at least one event — otherwise the connection won't fire.
                </div>
              )}
            </div>

            {error && (
              <div className="rounded-md border-l-2 border-destructive bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {error}
              </div>
            )}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={isPending}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={!canSubmit}>
              {isPending ? 'Saving…' : 'Save connection'}
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

function ListSkeleton() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {[0, 1].map((i) => <Skeleton key={i} className="h-32 rounded-xl" />)}
    </div>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border p-8 text-center">
      <MessageSquare className="size-10 text-muted-foreground/50" aria-hidden="true" />
      <div className="space-y-1">
        <div className="text-sm font-medium text-foreground">No integrations yet</div>
        <div className="text-xs text-muted-foreground max-w-md">
          Connect a Slack channel or Microsoft Teams channel to get pinged when issues move or sprints turn over.
        </div>
      </div>
      <Button size="sm" variant="primary" onClick={onCreate}>
        <Plus className="size-4" /> Add your first connection
      </Button>
    </div>
  );
}
