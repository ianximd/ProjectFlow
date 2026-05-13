'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Zap, Plus, Search, Filter, X, Edit3, Trash2,
  Power, History, Activity, Wand2, CircleDot, Pause, Play,
} from 'lucide-react';

import type {
  AutomationRule,
  AutomationTriggerType,
  AutomationActionType,
  AutomationConditionType,
  AutomationTriggerConfig,
  AutomationCondition,
  AutomationAction,
} from '@projectflow/types';

import { useStore } from '@/store/useStore';
import { notifyApiError } from '@/lib/apiErrorToast';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody, DialogFooter,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

// ── Labels ───────────────────────────────────────────────────────────────────

const TRIGGER_LABELS: Record<AutomationTriggerType, string> = {
  ISSUE_CREATED:        'Issue created',
  ISSUE_UPDATED:        'Issue updated',
  ISSUE_TRANSITIONED:   'Issue transitioned',
  SPRINT_STARTED:       'Sprint started',
  SPRINT_COMPLETED:     'Sprint completed',
  DUE_DATE_APPROACHING: 'Due date approaching',
  SCHEDULED:            'Scheduled (cron)',
  MANUAL:               'Manual / API trigger',
  WEBHOOK:              'Incoming webhook',
};

const ACTION_LABELS: Record<AutomationActionType, string> = {
  TRANSITION_ISSUE:  'Transition issue',
  ASSIGN_ISSUE:      'Assign issue',
  UNASSIGN_ISSUE:    'Unassign issue',
  SET_PRIORITY:      'Set priority',
  ADD_COMMENT:       'Add comment',
  SEND_NOTIFICATION: 'Send notification',
  TRIGGER_WEBHOOK:   'Trigger webhook',
};

const CONDITION_LABELS: Record<AutomationConditionType, string> = {
  ISSUE_MATCHES_FILTER: 'Issue matches filter',
  FIELD_EQUALS:         'Field equals',
  FIELD_NOT_EQUALS:     'Field not equals',
  USER_HAS_ROLE:        'User has role',
  IN_SPRINT:            'In sprint',
  NOT_IN_SPRINT:        'Not in sprint',
};

const PRIORITIES = ['HIGHEST', 'HIGH', 'MEDIUM', 'LOW', 'LOWEST'] as const;

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
  if (!res.ok) notifyApiError(json, res.status);
  return { ok: res.ok, status: res.status, json };
}

// "2026-05-11T03:53:33.350Z" → "May 11"
function shortDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_TRIGGER: AutomationTriggerConfig = { type: 'ISSUE_CREATED' };

export default function AutomationsPage() {
  const router      = useRouter();
  const qc          = useQueryClient();
  const accessToken = useStore((s) => s.accessToken);

  const currentWorkspaceId  = useStore((s) => s.currentWorkspaceId);
  const currentProjectId    = useStore((s) => s.currentProjectId);
  const setCurrentWorkspace = useStore((s) => s.setCurrentWorkspace);
  const setCurrentProject   = useStore((s) => s.setCurrentProject);
  const [search,       setSearch]       = useState('');
  const [enabledFilter, setEnabledFilter] = useState<'ALL' | 'ENABLED' | 'DISABLED'>('ALL');
  const [editing,      setEditing]      = useState<AutomationRule | null>(null);
  const [createOpen,   setCreateOpen]   = useState(false);

  // ── Workspace / project ────────────────────────────────────────────────────
  const { data: workspaces, isLoading: isLoadingWs } = useQuery<any[]>({
    queryKey: ['workspaces', accessToken],
    queryFn: async () => {
      const { status, ok, json } = await api('/workspaces', accessToken);
      if (status === 401) { router.push('/login'); return []; }
      const wss = ok ? (json.data ?? []) : [];
      if (wss.length === 0) router.push('/setup');
      return wss;
    },
  });
  const activeWorkspaceId = currentWorkspaceId ?? workspaces?.[0]?.Id ?? null;

  const { data: projects, isLoading: isLoadingProj } = useQuery<any[]>({
    queryKey: ['projects', activeWorkspaceId, accessToken],
    enabled: !!activeWorkspaceId,
    queryFn: async () => {
      const { ok, json } = await api(`/projects?workspaceId=${activeWorkspaceId}`, accessToken);
      return ok ? (json.data ?? []) : [];
    },
  });
  const activeProjectId = currentProjectId ?? projects?.[0]?.Id ?? null;
  const activeProject   = projects?.find((p: any) => p.Id === activeProjectId) ?? projects?.[0];

  // ── Rules ──────────────────────────────────────────────────────────────────
  const { data: rules, isLoading: isLoadingRules } = useQuery<AutomationRule[]>({
    queryKey: ['automations', activeProjectId, accessToken],
    enabled: !!activeProjectId,
    queryFn: async () => {
      const { ok, json } = await api(`/automations?projectId=${activeProjectId}`, accessToken);
      return ok ? (json.rules ?? []) : [];
    },
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['automations', activeProjectId] });

  // ── Mutations ──────────────────────────────────────────────────────────────
  const saveMutation = useMutation({
    mutationFn: async (input: {
      id?:         string;
      name:        string;
      trigger:     AutomationTriggerConfig;
      conditions:  AutomationCondition[];
      actions:     AutomationAction[];
    }) => {
      if (input.id) {
        const { ok, json } = await api(`/automations/${input.id}`, accessToken, {
          method: 'PATCH',
          body: JSON.stringify({
            name: input.name, trigger: input.trigger, conditions: input.conditions, actions: input.actions,
          }),
        });
        if (!ok) throw new Error(json?.error ?? 'Update failed');
        return json;
      }
      const { ok, json } = await api('/automations', accessToken, {
        method: 'POST',
        body: JSON.stringify({
          projectId: activeProjectId,
          name: input.name, trigger: input.trigger, conditions: input.conditions, actions: input.actions,
        }),
      });
      if (!ok) throw new Error(json?.error ?? 'Create failed');
      return json;
    },
    onSuccess: () => { invalidate(); setEditing(null); setCreateOpen(false); },
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      const { ok, json } = await api(`/automations/${id}/toggle`, accessToken, {
        method: 'POST', body: JSON.stringify({ isEnabled: enabled }),
      });
      if (!ok) throw new Error(json?.error ?? 'Toggle failed');
    },
    onSuccess: invalidate,
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { ok } = await api(`/automations/${id}`, accessToken, { method: 'DELETE' });
      if (!ok) throw new Error('Delete failed');
    },
    onSuccess: invalidate,
  });

  // ── KPIs ───────────────────────────────────────────────────────────────────
  const kpi = useMemo(() => {
    const all = rules ?? [];
    return {
      total:    all.length,
      enabled:  all.filter((r) => r.isEnabled).length,
      disabled: all.filter((r) => !r.isEnabled).length,
      runs:     all.reduce((acc, r) => acc + (r.executionCount ?? 0), 0),
    };
  }, [rules]);

  // ── Filter pipeline ────────────────────────────────────────────────────────
  const filteredRules = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (rules ?? []).filter((r) => {
      if (enabledFilter === 'ENABLED'  && !r.isEnabled) return false;
      if (enabledFilter === 'DISABLED' &&  r.isEnabled) return false;
      if (q && !r.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rules, search, enabledFilter]);

  // ── Derived UI state ───────────────────────────────────────────────────────
  const isInitialLoading = isLoadingWs || isLoadingProj || (!!activeProjectId && isLoadingRules && !rules);
  const noProject = !activeProjectId && !isLoadingProj && !isLoadingWs;
  const activeFilterCount = (enabledFilter !== 'ALL' ? 1 : 0) + (search.trim() ? 1 : 0);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-full flex-col gap-4">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <div className="rounded-lg bg-primary/10 p-2 text-primary">
            <Zap className="size-5" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>Automations</span>
              {activeProject?.Key && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono">{activeProject.Key}</span>
                </>
              )}
            </div>
            <h2 className="text-base font-semibold text-foreground truncate">
              {activeProject?.Name ?? (isLoadingProj ? 'Loading…' : 'No project')}
            </h2>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {workspaces && workspaces.length > 1 && (
            <Select
              value={activeWorkspaceId ?? undefined}
              onValueChange={(v) => setCurrentWorkspace(v)}
            >
              <SelectTrigger className="h-8 w-[180px] text-xs">
                <SelectValue placeholder="Workspace" />
              </SelectTrigger>
              <SelectContent>
                {workspaces.map((ws: any) => (
                  <SelectItem key={ws.Id} value={ws.Id}>{ws.Name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {projects && projects.length > 1 && (
            <Select value={activeProjectId ?? undefined} onValueChange={(v) => setCurrentProject(v)}>
              <SelectTrigger className="h-8 w-[200px] text-xs">
                <SelectValue placeholder="Project" />
              </SelectTrigger>
              <SelectContent>
                {projects.map((p: any) => (
                  <SelectItem key={p.Id} value={p.Id}>
                    <span className="font-mono mr-2 text-muted-foreground">{p.Key}</span>
                    {p.Name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button size="sm" variant="primary" onClick={() => setCreateOpen(true)} disabled={!activeProjectId}>
            <Plus className="size-4" /> New rule
          </Button>
        </div>
      </div>

      {isInitialLoading ? (
        <AutomationsSkeleton />
      ) : noProject ? (
        <EmptyProjectState />
      ) : (
        <>
          {/* ── KPI tiles ──────────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KpiTile icon={Zap}       label="Total rules" value={kpi.total}    tone="default" />
            <KpiTile icon={Play}      label="Enabled"     value={kpi.enabled}  tone="success" />
            <KpiTile icon={Pause}     label="Disabled"    value={kpi.disabled} tone="muted" />
            <KpiTile icon={Activity}  label="Total runs"  value={kpi.runs}     tone="info" />
          </div>

          {/* ── Filter bar ────────────────────────────────────────────────── */}
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/30 p-2">
            <div className="relative flex-1 min-w-[180px]">
              <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search rule name…"
                className="h-8 pl-7 text-xs"
                aria-label="Filter automations by name"
              />
            </div>
            <Select value={enabledFilter} onValueChange={(v) => setEnabledFilter(v as typeof enabledFilter)}>
              <SelectTrigger className="h-8 w-[140px] text-xs"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All rules</SelectItem>
                <SelectItem value="ENABLED">Enabled only</SelectItem>
                <SelectItem value="DISABLED">Disabled only</SelectItem>
              </SelectContent>
            </Select>
            {activeFilterCount > 0 && (
              <>
                <Badge variant="outline" size="sm" appearance="outline" className="ml-1">
                  <Filter className="size-3" /> {activeFilterCount}
                </Badge>
                <Button
                  size="sm" variant="ghost"
                  onClick={() => { setSearch(''); setEnabledFilter('ALL'); }}
                  className="h-8 px-2 text-xs"
                >
                  <X className="size-3.5" /> Clear
                </Button>
              </>
            )}
            <div className="ml-auto text-xs text-muted-foreground">
              Showing <strong className="text-foreground">{filteredRules.length}</strong> of <strong className="text-foreground">{rules?.length ?? 0}</strong>
            </div>
          </div>

          {/* ── Rule list ─────────────────────────────────────────────────── */}
          {!rules || rules.length === 0 ? (
            <EmptyRulesState onCreate={() => setCreateOpen(true)} />
          ) : filteredRules.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
              No rules match the current filters.
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {filteredRules.map((r) => (
                <RuleRow
                  key={r.id}
                  rule={r}
                  busy={toggleMutation.isPending || deleteMutation.isPending}
                  onToggle={() => toggleMutation.mutate({ id: r.id, enabled: !r.isEnabled })}
                  onEdit={() => setEditing(r)}
                  onDelete={() => {
                    if (window.confirm(`Delete rule "${r.name}"?`)) deleteMutation.mutate(r.id);
                  }}
                />
              ))}
            </div>
          )}
        </>
      )}

      <RuleDialog
        mode="create"
        open={createOpen}
        initial={null}
        onClose={() => setCreateOpen(false)}
        onSubmit={(input) => saveMutation.mutate(input)}
        isPending={saveMutation.isPending}
        error={(saveMutation.error as Error | null)?.message ?? null}
      />

      <RuleDialog
        mode="edit"
        open={!!editing}
        initial={editing}
        onClose={() => setEditing(null)}
        onSubmit={(input) => saveMutation.mutate({ ...input, id: editing!.id })}
        isPending={saveMutation.isPending}
        error={(saveMutation.error as Error | null)?.message ?? null}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Rule row
// ─────────────────────────────────────────────────────────────────────────────

function RuleRow({
  rule, busy, onToggle, onEdit, onDelete,
}: {
  rule: AutomationRule;
  busy: boolean;
  onToggle: () => void;
  onEdit:   () => void;
  onDelete: () => void;
}) {
  const lastRun = shortDate(rule.lastExecutedAt);
  return (
    <Card className={cn('p-4 transition-colors', !rule.isEnabled && 'opacity-70')}>
      <div className="flex items-start gap-3">
        <div className="pt-0.5 shrink-0">
          <Switch checked={rule.isEnabled} onCheckedChange={onToggle} disabled={busy} aria-label={rule.isEnabled ? 'Disable' : 'Enable'} />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-semibold text-foreground truncate">{rule.name}</h3>
            {rule.isEnabled
              ? <Badge size="xs" variant="outline" appearance="outline" className="bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">Enabled</Badge>
              : <Badge size="xs" variant="outline" appearance="outline" className="bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400">Disabled</Badge>}
          </div>

          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <Badge size="xs" variant="outline" appearance="outline" className="bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
              <Wand2 className="size-3 mr-1" />
              {TRIGGER_LABELS[rule.trigger.type]}
              {rule.trigger.type === 'ISSUE_TRANSITIONED' && rule.trigger.toStatus && ` → ${rule.trigger.toStatus}`}
              {rule.trigger.type === 'SCHEDULED' && rule.trigger.cron && ` · ${rule.trigger.cron}`}
            </Badge>

            {rule.conditions.length > 0 && (
              <Badge size="xs" variant="outline" appearance="outline">
                <CircleDot className="size-3 mr-1" />
                {rule.conditions.length} {rule.conditions.length === 1 ? 'condition' : 'conditions'}
              </Badge>
            )}

            {rule.actions.map((a, i) => (
              <Badge key={i} size="xs" variant="outline" appearance="outline" className="font-normal">
                {ACTION_LABELS[a.type]}
              </Badge>
            ))}
          </div>

          <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Activity className="size-3" />
              {rule.executionCount.toLocaleString()} {rule.executionCount === 1 ? 'run' : 'runs'}
            </span>
            {lastRun && (
              <span className="inline-flex items-center gap-1">
                <History className="size-3" /> last {lastRun}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <Button size="sm" variant="ghost" onClick={onEdit} aria-label="Edit">
            <Edit3 className="size-3.5" />
          </Button>
          <Button
            size="sm" variant="ghost"
            onClick={onDelete} disabled={busy}
            aria-label="Delete"
            className="text-destructive hover:text-destructive"
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      </div>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Rule dialog (create + edit)
// ─────────────────────────────────────────────────────────────────────────────

function RuleDialog({
  mode, open, initial, onClose, onSubmit, isPending, error,
}: {
  mode: 'create' | 'edit';
  open: boolean;
  initial: AutomationRule | null;
  onClose: () => void;
  onSubmit: (input: {
    name: string;
    trigger: AutomationTriggerConfig;
    conditions: AutomationCondition[];
    actions: AutomationAction[];
  }) => void;
  isPending: boolean;
  error: string | null;
}) {
  // State is seeded from `initial` on every fresh mount; we key the inner
  // <DialogContent> on initial?.id ?? mode so editing a different row gets
  // a clean slate.
  const [name,       setName]       = useState(initial?.name ?? '');
  const [trigger,    setTrigger]    = useState<AutomationTriggerConfig>(initial?.trigger ?? DEFAULT_TRIGGER);
  const [conditions, setConditions] = useState<AutomationCondition[]>(initial?.conditions ?? []);
  const [actions,    setActions]    = useState<AutomationAction[]>(initial?.actions ?? []);

  const canSubmit = name.trim().length > 0 && actions.length > 0 && !isPending;

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => { if (!v) onClose(); }}
    >
      <DialogContent key={initial?.id ?? mode} className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{mode === 'create' ? 'New automation rule' : `Edit ${initial?.name ?? 'rule'}`}</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e) => { e.preventDefault(); onSubmit({ name: name.trim(), trigger, conditions, actions }); }}
        >
          <DialogBody className="flex flex-col gap-5 max-h-[60vh] overflow-y-auto">
            {/* Name */}
            <div className="flex flex-col gap-1.5">
              <label htmlFor="rule-name" className="text-xs font-medium text-muted-foreground">Name</label>
              <Input
                id="rule-name" required autoFocus value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Auto-assign high priority bugs"
              />
            </div>

            {/* Trigger */}
            <TriggerEditor trigger={trigger} onChange={setTrigger} />

            {/* Conditions */}
            <ConditionList conditions={conditions} onChange={setConditions} />

            {/* Actions */}
            <ActionList actions={actions} onChange={setActions} />

            {error && (
              <div className="rounded-md border-l-2 border-destructive bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {error}
              </div>
            )}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={isPending}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={!canSubmit}>
              {isPending ? 'Saving…' : mode === 'create' ? 'Create rule' : 'Save changes'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Trigger / condition / action editors ─────────────────────────────────────

function SectionTitle({ icon: Icon, title, hint }: {
  icon: typeof Power; title: string; hint?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
      <h4 className="text-sm font-semibold text-foreground">{title}</h4>
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </div>
  );
}

function TriggerEditor({
  trigger, onChange,
}: {
  trigger: AutomationTriggerConfig;
  onChange: (t: AutomationTriggerConfig) => void;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border/60 bg-muted/20 p-3">
      <SectionTitle icon={Wand2} title="When" />
      <Select value={trigger.type} onValueChange={(v) => onChange({ ...trigger, type: v as AutomationTriggerType })}>
        <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
        <SelectContent>
          {(Object.keys(TRIGGER_LABELS) as AutomationTriggerType[]).map((t) => (
            <SelectItem key={t} value={t}>{TRIGGER_LABELS[t]}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {trigger.type === 'ISSUE_TRANSITIONED' && (
        <Input
          placeholder="Only when transitioning to status (optional)"
          value={trigger.toStatus ?? ''}
          onChange={(e) => onChange({ ...trigger, toStatus: e.target.value || undefined })}
          className="h-9 text-sm"
        />
      )}
      {trigger.type === 'DUE_DATE_APPROACHING' && (
        <Input
          type="number" min={0}
          placeholder="Hours before due date"
          value={trigger.hoursBeforeDue ?? ''}
          onChange={(e) => onChange({ ...trigger, hoursBeforeDue: e.target.value ? Number(e.target.value) : undefined })}
          className="h-9 text-sm"
        />
      )}
      {trigger.type === 'SCHEDULED' && (
        <div className="flex flex-col gap-1.5">
          <Input
            placeholder="Cron expression, e.g. 0 9 * * 1"
            value={trigger.cron ?? ''}
            onChange={(e) => onChange({ ...trigger, cron: e.target.value || undefined })}
            className="h-9 text-sm font-mono"
          />
          <span className="text-xs text-muted-foreground">
            Standard 5-field crontab. <span className="font-mono">0 9 * * 1</span> means every Monday at 09:00.
          </span>
        </div>
      )}
    </div>
  );
}

function ConditionList({
  conditions, onChange,
}: {
  conditions: AutomationCondition[];
  onChange: (c: AutomationCondition[]) => void;
}) {
  const add = () =>
    onChange([...conditions, { type: 'FIELD_EQUALS', field: 'priority', value: 'HIGH' }]);
  const remove = (i: number) => onChange(conditions.filter((_, idx) => idx !== i));
  const update = (i: number, patch: Partial<AutomationCondition>) =>
    onChange(conditions.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border/60 bg-muted/20 p-3">
      <div className="flex items-center justify-between">
        <SectionTitle icon={CircleDot} title="If" hint="(all conditions must match — leave empty to fire on every event)" />
        <Button type="button" size="sm" variant="ghost" onClick={add} className="h-7 px-2 text-xs">
          <Plus className="size-3.5" /> Add condition
        </Button>
      </div>

      {conditions.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">No conditions — rule fires for all events.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {conditions.map((cond, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <Select value={cond.type} onValueChange={(v) => update(i, { type: v as AutomationConditionType })}>
                <SelectTrigger className="h-8 w-[170px] text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(CONDITION_LABELS) as AutomationConditionType[]).map((t) => (
                    <SelectItem key={t} value={t}>{CONDITION_LABELS[t]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {(cond.type === 'FIELD_EQUALS' || cond.type === 'FIELD_NOT_EQUALS') && (
                <>
                  <Input
                    placeholder="field"
                    value={cond.field ?? ''}
                    onChange={(e) => update(i, { field: e.target.value })}
                    className="h-8 w-[140px] text-xs"
                  />
                  <Input
                    placeholder="value"
                    value={cond.value ?? ''}
                    onChange={(e) => update(i, { value: e.target.value })}
                    className="h-8 flex-1 min-w-[120px] text-xs"
                  />
                </>
              )}
              {(cond.type === 'IN_SPRINT' || cond.type === 'NOT_IN_SPRINT') && (
                <Input
                  placeholder="Sprint name or ID (optional)"
                  value={cond.value ?? ''}
                  onChange={(e) => update(i, { value: e.target.value })}
                  className="h-8 flex-1 min-w-[120px] text-xs"
                />
              )}
              <Button
                type="button" size="sm" variant="ghost"
                className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                onClick={() => remove(i)}
                aria-label="Remove condition"
              >
                <X className="size-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ActionList({
  actions, onChange,
}: {
  actions: AutomationAction[];
  onChange: (a: AutomationAction[]) => void;
}) {
  const add = () => onChange([...actions, { type: 'SEND_NOTIFICATION', message: '' }]);
  const remove = (i: number) => onChange(actions.filter((_, idx) => idx !== i));
  const update = (i: number, patch: Partial<AutomationAction>) =>
    onChange(actions.map((a, idx) => (idx === i ? { ...a, ...patch } : a)));

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border/60 bg-muted/20 p-3">
      <div className="flex items-center justify-between">
        <SectionTitle icon={Power} title="Then" hint="(at least one action required)" />
        <Button type="button" size="sm" variant="ghost" onClick={add} className="h-7 px-2 text-xs">
          <Plus className="size-3.5" /> Add action
        </Button>
      </div>

      {actions.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">Add at least one action.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {actions.map((action, i) => (
            <div key={i} className="rounded-md border border-border/40 bg-card p-2.5 flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <Select value={action.type} onValueChange={(v) => update(i, { type: v as AutomationActionType })}>
                  <SelectTrigger className="h-8 flex-1 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(ACTION_LABELS) as AutomationActionType[]).map((t) => (
                      <SelectItem key={t} value={t}>{ACTION_LABELS[t]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button" size="sm" variant="ghost"
                  className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                  onClick={() => remove(i)}
                  aria-label="Remove action"
                >
                  <X className="size-3.5" />
                </Button>
              </div>

              {action.type === 'TRANSITION_ISSUE' && (
                <Input
                  placeholder="Target status name"
                  value={action.toStatus ?? ''}
                  onChange={(e) => update(i, { toStatus: e.target.value })}
                  className="h-8 text-xs"
                />
              )}
              {action.type === 'ASSIGN_ISSUE' && (
                <Input
                  placeholder='User ID or "REPORTER"'
                  value={action.assigneeId ?? ''}
                  onChange={(e) => update(i, { assigneeId: e.target.value })}
                  className="h-8 text-xs font-mono"
                />
              )}
              {action.type === 'SET_PRIORITY' && (
                <Select value={action.priority ?? 'MEDIUM'} onValueChange={(v) => update(i, { priority: v })}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PRIORITIES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
              {(action.type === 'ADD_COMMENT' || action.type === 'SEND_NOTIFICATION') && (
                <textarea
                  placeholder="Message"
                  value={action.message ?? ''}
                  onChange={(e) => update(i, { message: e.target.value })}
                  rows={2}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:border-ring resize-none"
                />
              )}
              {action.type === 'TRIGGER_WEBHOOK' && (
                <Input
                  type="url"
                  placeholder="https://hooks.example.com/…"
                  value={action.webhookUrl ?? ''}
                  onChange={(e) => update(i, { webhookUrl: e.target.value })}
                  className="h-8 text-xs font-mono"
                />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// KPI / empty / skeleton
// ─────────────────────────────────────────────────────────────────────────────

type KpiTone = 'default' | 'info' | 'success' | 'danger' | 'muted';

function KpiTile({
  icon: Icon, label, value, tone = 'default',
}: {
  icon: typeof Zap;
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

function AutomationsSkeleton() {
  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
      </div>
      <div className="flex flex-col gap-3 mt-3">
        {[0, 1, 2].map((i) => <Skeleton key={i} className="h-28 rounded-xl" />)}
      </div>
    </>
  );
}

function EmptyProjectState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border p-8 text-center">
      <Zap className="size-10 text-muted-foreground/50" aria-hidden="true" />
      <div className="space-y-1">
        <div className="text-sm font-medium text-foreground">No project to automate</div>
        <div className="text-xs text-muted-foreground max-w-sm">
          Create a project in this workspace, then come back to build rules that move issues for you.
        </div>
      </div>
    </div>
  );
}

function EmptyRulesState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border p-8 text-center">
      <Zap className="size-10 text-muted-foreground/50" aria-hidden="true" />
      <div className="space-y-1">
        <div className="text-sm font-medium text-foreground">No rules yet</div>
        <div className="text-xs text-muted-foreground max-w-sm">
          Automate repetitive work — auto-assign issues, transition them when criteria are met, send notifications, or call webhooks.
        </div>
      </div>
      <Button size="sm" variant="primary" onClick={onCreate}>
        <Plus className="size-4" /> Create your first rule
      </Button>
    </div>
  );
}
