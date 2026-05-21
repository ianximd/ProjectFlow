'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import {
  Webhook, Plus, Trash2, Send, CheckCircle2, AlertTriangle, ChevronDown,
  ChevronRight, Activity, ExternalLink, Info,
} from 'lucide-react';

import type {
  OutgoingWebhook,
  WebhookDelivery,
  OutgoingWebhookEvent,
} from '@projectflow/types';
import { formatShortDateTime } from '@/lib/date';

import {
  createOutgoingWebhook,
  deleteOutgoingWebhook,
  pingWebhook,
  loadOutgoingWebhooks,
  loadWebhookDeliveries,
} from '@/server/actions/webhooks';
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

const ALL_EVENTS: { value: OutgoingWebhookEvent; label: string; description: string }[] = [
  { value: 'issue.created',     label: 'Issue created',     description: 'A new task / story / bug is created' },
  { value: 'issue.updated',     label: 'Issue updated',     description: 'Any field on an existing issue changes' },
  { value: 'issue.deleted',     label: 'Issue deleted',     description: 'An issue is soft-deleted from a project' },
  { value: 'sprint.started',    label: 'Sprint started',    description: 'A sprint enters the ACTIVE state' },
  { value: 'sprint.completed',  label: 'Sprint completed',  description: 'A sprint is closed out' },
  { value: 'comment.created',   label: 'Comment created',   description: 'Someone leaves a comment on an issue' },
  { value: 'member.invited',    label: 'Member invited',    description: 'A user is added to this workspace' },
];

function shortDateTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '—';
  return formatShortDateTime(d);
}

// ─────────────────────────────────────────────────────────────────────────────

interface Props { workspaceId: string }

export default function WebhookManager({ workspaceId }: Props) {
  const [webhooks, setWebhooks] = useState<OutgoingWebhook[] | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, startCreate] = useTransition();
  const [deleting, startDelete] = useTransition();

  const refetch = () => loadOutgoingWebhooks(workspaceId).then(setWebhooks);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (workspaceId) refetch();
  }, [workspaceId]);

  const onCreate = (input: {
    name: string; url: string; secret: string; events: OutgoingWebhookEvent[];
  }) => startCreate(async () => {
    setCreateError(null);
    const r = await createOutgoingWebhook(workspaceId, input);
    if (!r.ok) { setCreateError(r.error); notifyActionError(r); return; }
    setCreateOpen(false);
    await refetch();
  });

  const onDelete = (id: string) => startDelete(async () => {
    const r = await deleteOutgoingWebhook(id);
    if (!r.ok) return notifyActionError(r);
    await refetch();
  });

  const isLoading = webhooks === null;

  return (
    <div className="flex flex-col gap-3 h-full">
      {/* ── Intro / hero ───────────────────────────────────────────────────── */}
      <Card className="p-4">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-primary/10 p-2 text-primary shrink-0">
            <Webhook className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-foreground">Outgoing webhooks</h3>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
              Subscribe a URL to events in this workspace. Each delivery is signed with{' '}
              <code className="font-mono text-foreground bg-muted/60 px-1 py-0.5 rounded">X-ProjectFlow-Signature</code>
              {' '}(HMAC-SHA256 of the body using your secret), so your endpoint can verify the call is real.
            </p>
          </div>
          <Button size="sm" variant="primary" onClick={() => setCreateOpen(true)} className="shrink-0">
            <Plus className="size-4" /> Add webhook
          </Button>
        </div>
      </Card>

      {/* ── Webhook list ──────────────────────────────────────────────────── */}
      {isLoading ? (
        <ListSkeleton />
      ) : !webhooks || webhooks.length === 0 ? (
        <EmptyState onCreate={() => setCreateOpen(true)} />
      ) : (
        <div className="flex flex-col gap-3">
          {webhooks.map((wh) => (
            <WebhookCard
              key={wh.id}
              webhook={wh}
              workspaceId={workspaceId}
              busy={deleting}
              onDelete={() => {
                if (window.confirm(`Delete webhook "${wh.name}"?\n\nFuture events will stop being delivered. Past delivery history is also removed.`)) {
                  onDelete(wh.id);
                }
              }}
            />
          ))}
        </div>
      )}

      <CreateWebhookDialog
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
// Webhook card (with inline ping + collapsible deliveries)
// ─────────────────────────────────────────────────────────────────────────────

function WebhookCard({
  webhook, workspaceId, onDelete, busy,
}: {
  webhook: OutgoingWebhook;
  workspaceId: string;
  onDelete: () => void;
  busy: boolean;
}) {
  const [pingStatus, setPingStatus] = useState<'idle' | 'pinging' | 'ok' | 'err'>('idle');
  const [pingError,  setPingError]  = useState('');
  const [pingCode,   setPingCode]   = useState<number | null>(null);
  const [showDeliveries, setShowDeliveries] = useState(false);

  // Deliveries fetched lazily — only when the user expands the section.
  const [deliveries, setDeliveries] = useState<WebhookDelivery[] | null>(null);
  const [loadingDeliveries, startDeliveries] = useTransition();
  // Rapid pings can enqueue overlapping refetches; a sequence guard ensures
  // only the latest response is applied (react-query used to dedupe this).
  const deliveriesSeq = useRef(0);

  const refetchDeliveries = () => {
    const seq = ++deliveriesSeq.current;
    startDeliveries(async () => {
      const rows = await loadWebhookDeliveries(webhook.id);
      if (seq === deliveriesSeq.current) setDeliveries(rows);
    });
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (showDeliveries && deliveries === null) refetchDeliveries();
  }, [showDeliveries]);

  const handlePing = async () => {
    setPingStatus('pinging'); setPingError(''); setPingCode(null);
    const r = await pingWebhook(webhook.id, workspaceId);
    if (!r.ok) {
      setPingStatus('err'); setPingError(r.error); notifyActionError(r);
    } else if (r.data.success) {
      setPingStatus('ok'); setPingCode(r.data.statusCode);
    } else {
      setPingStatus('err');
      setPingCode(r.data.statusCode);
      setPingError(r.data.error ?? 'Delivery failed');
    }
    // Refresh deliveries if expanded — the ping just created a new row.
    if (showDeliveries) refetchDeliveries();
  };

  return (
    <Card className={cn('p-4 flex flex-col gap-3', !webhook.isActive && 'opacity-70')}>
      {/* Top row: name + URL + actions */}
      <div className="flex items-start gap-3">
        <span className="inline-flex size-9 items-center justify-center rounded-md bg-muted text-foreground shrink-0">
          <Webhook className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap min-w-0">
            <h3 className="text-sm font-semibold text-foreground truncate">{webhook.name}</h3>
            {!webhook.isActive && (
              <Badge size="xs" variant="outline" appearance="outline" className="bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                Inactive
              </Badge>
            )}
          </div>
          <a
            href={webhook.url}
            target="_blank" rel="noreferrer"
            className="mt-0.5 inline-flex items-center gap-1 text-xs font-mono text-muted-foreground hover:text-foreground hover:underline max-w-full truncate"
          >
            <span className="truncate">{webhook.url}</span>
            <ExternalLink className="size-3 shrink-0" />
          </a>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button
            size="sm" variant="outline"
            onClick={handlePing}
            disabled={pingStatus === 'pinging' || !webhook.isActive}
          >
            <Send className="size-3.5" />
            {pingStatus === 'pinging' ? 'Pinging…' : 'Ping'}
          </Button>
          <Button
            size="sm" variant="ghost"
            className="text-destructive hover:text-destructive"
            onClick={onDelete}
            disabled={busy}
            aria-label={`Delete ${webhook.name}`}
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      </div>

      {/* Ping result strip (inline; not alert) */}
      {pingStatus === 'ok' && (
        <div className="inline-flex items-center gap-1.5 rounded-md bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 px-2.5 py-1 text-xs font-medium w-fit">
          <CheckCircle2 className="size-3.5" /> Ping delivered {pingCode != null && `· HTTP ${pingCode}`}
        </div>
      )}
      {pingStatus === 'err' && (
        <div className="inline-flex items-center gap-1.5 rounded-md bg-red-100 dark:bg-red-950 text-red-700 dark:text-red-300 px-2.5 py-1 text-xs font-medium w-fit">
          <AlertTriangle className="size-3.5" />
          Ping failed {pingCode != null && `· HTTP ${pingCode}`} {pingError && `· ${pingError}`}
        </div>
      )}

      {/* Subscribed event chips */}
      <div className="flex flex-wrap gap-1.5">
        {ALL_EVENTS.map((e) => {
          const enabled = webhook.events.includes(e.value);
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
              <span className="font-mono">{e.value}</span>
            </Badge>
          );
        })}
      </div>

      {/* Deliveries collapser */}
      <div className="border-t border-border/60 pt-2">
        <button
          type="button"
          className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
          onClick={() => setShowDeliveries((v) => !v)}
          aria-expanded={showDeliveries}
        >
          {showDeliveries ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
          <Activity className="size-3.5" />
          Recent deliveries
        </button>

        {showDeliveries && (
          <div className="mt-2">
            {loadingDeliveries && deliveries === null ? (
              <Skeleton className="h-24 w-full" />
            ) : !deliveries || deliveries.length === 0 ? (
              <div className="rounded-md border border-dashed border-border p-3 text-center text-xs text-muted-foreground">
                No deliveries yet. Use Ping above to send a test event, or wait for a real event to fire.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-md border border-border/60">
                <table className="w-full text-xs">
                  <thead className="bg-muted/40">
                    <tr className="text-left font-medium text-muted-foreground uppercase tracking-wide">
                      <th className="px-3 py-2 w-[1%]"></th>
                      <th className="px-3 py-2">Event</th>
                      <th className="px-3 py-2">HTTP</th>
                      <th className="px-3 py-2">Duration</th>
                      <th className="px-3 py-2">Attempt</th>
                      <th className="px-3 py-2">Delivered</th>
                    </tr>
                  </thead>
                  <tbody>
                    {deliveries.map((d) => (
                      <tr key={d.id} className="border-t border-border/40">
                        <td className="px-3 py-2">
                          {d.success
                            ? <CheckCircle2 className="size-3.5 text-emerald-500" aria-label="Success" />
                            : <AlertTriangle className="size-3.5 text-destructive" aria-label="Failure" />}
                        </td>
                        <td className="px-3 py-2 font-mono">{d.event}</td>
                        <td className="px-3 py-2 tabular-nums">{d.statusCode ?? '–'}</td>
                        <td className="px-3 py-2 tabular-nums">{d.durationMs != null ? `${d.durationMs}ms` : '–'}</td>
                        <td className="px-3 py-2 tabular-nums">#{d.attempt}</td>
                        <td className="px-3 py-2 text-muted-foreground">{shortDateTime(d.deliveredAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Create dialog
// ─────────────────────────────────────────────────────────────────────────────

function CreateWebhookDialog({
  open, onClose, onSubmit, isPending, error,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (input: {
    name: string; url: string; secret: string; events: OutgoingWebhookEvent[];
  }) => void;
  isPending: boolean;
  error: string | null;
}) {
  const [name,   setName]   = useState('');
  const [url,    setUrl]    = useState('');
  const [secret, setSecret] = useState('');
  const [events, setEvents] = useState<OutgoingWebhookEvent[]>(['issue.created']);

  const toggleEvent = (ev: OutgoingWebhookEvent) =>
    setEvents((prev) => prev.includes(ev) ? prev.filter((e) => e !== ev) : [...prev, ev]);

  const canSubmit =
    name.trim() && url.trim() && secret.length >= 8 && events.length > 0 && !isPending;

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) {
          onClose();
          setName(''); setUrl(''); setSecret(''); setEvents(['issue.created']);
        }
      }}
    >
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>New outgoing webhook</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit({ name: name.trim(), url: url.trim(), secret, events });
          }}
        >
          <DialogBody className="flex flex-col gap-4 max-h-[60vh] overflow-y-auto">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="wh-name" className="text-xs font-medium text-muted-foreground">Name</label>
              <Input
                id="wh-name" required autoFocus value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. CRM sync"
              />
              <span className="text-xs text-muted-foreground">Shown in the connection list. Anything you'll recognise later.</span>
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="wh-url" className="text-xs font-medium text-muted-foreground">Payload URL</label>
              <Input
                id="wh-url" type="url" required value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://example.com/hooks/projectflow"
                autoComplete="off"
                className="font-mono text-xs"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="wh-secret" className="text-xs font-medium text-muted-foreground">Secret</label>
              <Input
                id="wh-secret" type="password" required minLength={8}
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                placeholder="At least 8 characters"
                autoComplete="new-password"
              />
              <span className="text-xs text-muted-foreground">
                Used to sign each request with{' '}
                <code className="font-mono text-foreground bg-muted/60 px-1 py-0.5 rounded">X-ProjectFlow-Signature</code>{' '}
                (HMAC-SHA256). Your endpoint should verify this header before trusting the payload.
              </span>
            </div>

            {/* Events */}
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-muted-foreground">Subscribe to events</label>
                <div className="flex items-center gap-2 text-xs">
                  <button
                    type="button"
                    className="text-primary hover:underline"
                    onClick={() => setEvents(ALL_EVENTS.map((e) => e.value))}
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
                        <span className="text-sm font-medium text-foreground font-mono">{e.value}</span>
                        <span className="text-xs text-muted-foreground">{e.description}</span>
                      </div>
                    </label>
                  );
                })}
              </div>
              {events.length === 0 && (
                <div className="text-xs text-amber-700 dark:text-amber-300 inline-flex items-center gap-1">
                  <Info className="size-3.5" /> Pick at least one event — otherwise the webhook won't fire.
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
              {isPending ? 'Saving…' : 'Save webhook'}
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
    <div className="flex flex-col gap-3">
      {[0, 1].map((i) => <Skeleton key={i} className="h-32 rounded-xl" />)}
    </div>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border p-8 text-center">
      <Webhook className="size-10 text-muted-foreground/50" aria-hidden="true" />
      <div className="space-y-1">
        <div className="text-sm font-medium text-foreground">No webhooks yet</div>
        <div className="text-xs text-muted-foreground max-w-md">
          Forward events from this workspace to your own services — CRM sync, audit pipelines,
          chatops scripts. Each delivery is signed so your endpoint can verify it.
        </div>
      </div>
      <Button size="sm" variant="primary" onClick={onCreate}>
        <Plus className="size-4" /> Add your first webhook
      </Button>
    </div>
  );
}
