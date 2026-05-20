'use client';

import { useMemo, useState, useTransition } from 'react';
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

import { notifyActionError } from '@/lib/apiErrorToast';
import {
  createAutomation,
  updateAutomation,
  toggleAutomation,
  deleteAutomation,
} from '@/server/actions/automations';
import {
  useSelectionBridge,
  WorkspaceProjectSwitcher,
} from '@/app/(app)/_components/selection-bridge';
import type { WorkspaceProjectContext } from '@/server/context';
import type { Automation } from '@/server/queries/automations';
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

// ── Labels ────────────────────────────────────────────────────────────────────

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

// ── Helpers ───────────────────────────────────────────────────────────────────

function shortDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

const DEFAULT_TRIGGER: AutomationTriggerConfig = { type: 'ISSUE_CREATED' };

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  ctx:         WorkspaceProjectContext;
  automations: Automation[];
}

// ── View ──────────────────────────────────────────────────────────────────────

export function AutomationsView({ ctx, automations }: Props) {
  const [isPending, startTransition] = useTransition();

  const [search,        setSearch]        = useState('');
  const [enabledFilter, setEnabledFilter] = useState<'ALL' | 'ENABLED' | 'DISABLED'>('ALL');
  const [editing,       setEditing]       = useState<Automation | null>(null);
  const [createOpen,    setCreateOpen]    = useState(false);

  // Create/edit error state
  const [saveError,   setSaveError]   = useState<string | null>(null);
  const [isSaving,    setIsSaving]    = useState(false);

  // ── Selection bridge ────────────────────────────────────────────────────────
  useSelectionBridge({
    activeWorkspaceId: ctx.activeWorkspaceId,
    activeProjectId:   ctx.activeProjectId,
    cookieWorkspaceId: ctx.cookieWorkspaceId,
    cookieProjectId:   ctx.cookieProjectId,
    workspaceIds:      ctx.workspaces.map((w) => w.id),
    projectIds:        ctx.projects.map((p) => p.id),
  });

  const activeProject = ctx.projects.find((p) => p.id === ctx.activeProjectId) ?? ctx.projects[0];

  // ── KPIs ────────────────────────────────────────────────────────────────────
  const kpi = useMemo(() => {
    const all = automations;
    return {
      total:    all.length,
      enabled:  all.filter((r) => r.isEnabled).length,
      disabled: all.filter((r) => !r.isEnabled).length,
      runs:     all.reduce((acc, r) => acc + (r.executionCount as number ?? 0), 0),
    };
  }, [automations]);

  // ── Filter pipeline ─────────────────────────────────────────────────────────
  const filteredRules = useMemo(() => {
    const q = search.trim().toLowerCase();
    return automations.filter((r) => {
      if (enabledFilter === 'ENABLED'  && !r.isEnabled) return false;
      if (enabledFilter === 'DISABLED' &&  r.isEnabled) return false;
      if (q && !r.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [automations, search, enabledFilter]);

  const activeFilterCount = (enabledFilter !== 'ALL' ? 1 : 0) + (search.trim() ? 1 : 0);
  const noProject = !ctx.activeProjectId;

  // ── Mutation helpers ────────────────────────────────────────────────────────
  function handleToggle(id: string, next: boolean) {
    startTransition(async () => {
      const res = await toggleAutomation(id, next);
      if (!res.ok) notifyActionError(res);
    });
  }

  function handleDelete(id: string, name: string) {
    if (!window.confirm(`Delete rule "${name}"?`)) return;
    startTransition(async () => {
      const res = await deleteAutomation(id);
      if (!res.ok) notifyActionError(res);
    });
  }

  async function handleSave(input: {
    name:       string;
    trigger:    AutomationTriggerConfig;
    conditions: AutomationCondition[];
    actions:    AutomationAction[];
  }) {
    setSaveError(null);
    setIsSaving(true);
    try {
      let res;
      if (editing) {
        res = await updateAutomation(editing.id, {
          name:       input.name,
          trigger:    input.trigger,
          conditions: input.conditions,
          actions:    input.actions,
        });
      } else {
        res = await createAutomation({
          projectId:  ctx.activeProjectId!,
          name:       input.name,
          trigger:    input.trigger,
          conditions: input.conditions,
          actions:    input.actions,
        });
      }
      if (!res.ok) {
        setSaveError(res.error);
        notifyActionError(res);
      } else {
        setEditing(null);
        setCreateOpen(false);
      }
    } finally {
      setIsSaving(false);
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────
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
              {(activeProject as any)?.key && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono">{(activeProject as any).key}</span>
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
          <Button
            size="sm"
            variant="primary"
            onClick={() => setCreateOpen(true)}
            disabled={!ctx.activeProjectId}
          >
            <Plus className="size-4" /> New rule
          </Button>
        </div>
      </div>

      {noProject ? (
        <EmptyProjectState />
      ) : (
        <>
          {/* ── KPI tiles ──────────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KpiTile icon={Zap}      label="Total rules" value={kpi.total}    tone="default" />
            <KpiTile icon={Play}     label="Enabled"     value={kpi.enabled}  tone="success" />
            <KpiTile icon={Pause}    label="Disabled"    value={kpi.disabled} tone="muted" />
            <KpiTile icon={Activity} label="Total runs"  value={kpi.runs}     tone="info" />
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
            <Select
              value={enabledFilter}
              onValueChange={(v) => setEnabledFilter(v as typeof enabledFilter)}
            >
              <SelectTrigger className="h-8 w-[140px] text-xs">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
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
              Showing{' '}
              <strong className="text-foreground">{filteredRules.length}</strong>
              {' '}of{' '}
              <strong className="text-foreground">{automations.length}</strong>
            </div>
          </div>

          {/* ── Rule list ─────────────────────────────────────────────────── */}
          {automations.length === 0 ? (
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
                  busy={isPending}
                  onToggle={() => handleToggle(r.id, !r.isEnabled)}
                  onEdit={() => { setSaveError(null); setEditing(r); }}
                  onDelete={() => handleDelete(r.id, r.name)}
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* ── Dialogs ─────────────────────────────────────────────────────────── */}
      <RuleDialog
        mode="create"
        open={createOpen}
        initial={null}
        onClose={() => { setCreateOpen(false); setSaveError(null); }}
        onSubmit={handleSave}
        isPending={isSaving}
        error={createOpen ? saveError : null}
      />

      <RuleDialog
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

// ─────────────────────────────────────────────────────────────────────────────
// Rule row
// ─────────────────────────────────────────────────────────────────────────────

function RuleRow({
  rule, busy, onToggle, onEdit, onDelete,
}: {
  rule:     Automation;
  busy:     boolean;
  onToggle: () => void;
  onEdit:   () => void;
  onDelete: () => void;
}) {
  const lastRun = shortDate(rule.lastExecutedAt as string | null);
  const trigger = rule.trigger as AutomationTriggerConfig | null;
  const conditions = rule.conditions as AutomationCondition[];
  const actions    = rule.actions    as AutomationAction[];

  return (
    <Card className={cn('p-4 transition-colors', !rule.isEnabled && 'opacity-70')}>
      <div className="flex items-start gap-3">
        <div className="pt-0.5 shrink-0">
          <Switch
            checked={rule.isEnabled}
            onCheckedChange={onToggle}
            disabled={busy}
            aria-label={rule.isEnabled ? 'Disable' : 'Enable'}
          />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-semibold text-foreground truncate">{rule.name}</h3>
            {rule.isEnabled
              ? <Badge size="xs" variant="outline" appearance="outline" className="bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">Enabled</Badge>
              : <Badge size="xs" variant="outline" appearance="outline" className="bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400">Disabled</Badge>}
          </div>

          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {trigger && (
              <Badge size="xs" variant="outline" appearance="outline" className="bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
                <Wand2 className="size-3 mr-1" />
                {TRIGGER_LABELS[trigger.type as AutomationTriggerType] ?? trigger.type}
                {trigger.type === 'ISSUE_TRANSITIONED' && (trigger as any).toStatus && ` → ${(trigger as any).toStatus}`}
                {trigger.type === 'SCHEDULED' && (trigger as any).cron && ` · ${(trigger as any).cron}`}
              </Badge>
            )}

            {conditions.length > 0 && (
              <Badge size="xs" variant="outline" appearance="outline">
                <CircleDot className="size-3 mr-1" />
                {conditions.length} {conditions.length === 1 ? 'condition' : 'conditions'}
              </Badge>
            )}

            {actions.map((a, i) => (
              <Badge key={i} size="xs" variant="outline" appearance="outline" className="font-normal">
                {ACTION_LABELS[a.type as AutomationActionType] ?? a.type}
              </Badge>
            ))}
          </div>

          <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Activity className="size-3" />
              {(rule.executionCount as number).toLocaleString()}{' '}
              {rule.executionCount === 1 ? 'run' : 'runs'}
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
// Rule dialog (create + edit) — nested trigger/condition/action editor state
// is fully client-side and kept intact from the original CSR implementation.
// ─────────────────────────────────────────────────────────────────────────────

function RuleDialog({
  mode, open, initial, onClose, onSubmit, isPending, error,
}: {
  mode:      'create' | 'edit';
  open:      boolean;
  initial:   Automation | null;
  onClose:   () => void;
  onSubmit:  (input: {
    name:       string;
    trigger:    AutomationTriggerConfig;
    conditions: AutomationCondition[];
    actions:    AutomationAction[];
  }) => void;
  isPending: boolean;
  error:     string | null;
}) {
  const [name,       setName]       = useState(initial?.name ?? '');
  const [trigger,    setTrigger]    = useState<AutomationTriggerConfig>(
    (initial?.trigger as AutomationTriggerConfig) ?? DEFAULT_TRIGGER,
  );
  const [conditions, setConditions] = useState<AutomationCondition[]>(
    (initial?.conditions as AutomationCondition[]) ?? [],
  );
  const [actions,    setActions]    = useState<AutomationAction[]>(
    (initial?.actions as AutomationAction[]) ?? [],
  );

  const canSubmit = name.trim().length > 0 && actions.length > 0 && !isPending;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent key={initial?.id ?? mode} className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {mode === 'create' ? 'New automation rule' : `Edit ${initial?.name ?? 'rule'}`}
          </DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit({ name: name.trim(), trigger, conditions, actions });
          }}
        >
          <DialogBody className="flex flex-col gap-5 max-h-[60vh] overflow-y-auto">
            {/* Name */}
            <div className="flex flex-col gap-1.5">
              <label htmlFor="rule-name" className="text-xs font-medium text-muted-foreground">
                Name
              </label>
              <Input
                id="rule-name"
                required
                autoFocus
                value={name}
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
            <Button type="button" variant="outline" onClick={onClose} disabled={isPending}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={!canSubmit}>
              {isPending ? 'Saving…' : mode === 'create' ? 'Create rule' : 'Save changes'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Trigger / condition / action editors ──────────────────────────────────────

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
  trigger:  AutomationTriggerConfig;
  onChange: (t: AutomationTriggerConfig) => void;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border/60 bg-muted/20 p-3">
      <SectionTitle icon={Wand2} title="When" />
      <Select
        value={trigger.type}
        onValueChange={(v) => onChange({ ...trigger, type: v as AutomationTriggerType })}
      >
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
          value={(trigger as any).toStatus ?? ''}
          onChange={(e) => onChange({ ...trigger, toStatus: e.target.value || undefined } as any)}
          className="h-9 text-sm"
        />
      )}
      {trigger.type === 'DUE_DATE_APPROACHING' && (
        <Input
          type="number" min={0}
          placeholder="Hours before due date"
          value={(trigger as any).hoursBeforeDue ?? ''}
          onChange={(e) => onChange({
            ...trigger,
            hoursBeforeDue: e.target.value ? Number(e.target.value) : undefined,
          } as any)}
          className="h-9 text-sm"
        />
      )}
      {trigger.type === 'SCHEDULED' && (
        <div className="flex flex-col gap-1.5">
          <Input
            placeholder="Cron expression, e.g. 0 9 * * 1"
            value={(trigger as any).cron ?? ''}
            onChange={(e) => onChange({ ...trigger, cron: e.target.value || undefined } as any)}
            className="h-9 text-sm font-mono"
          />
          <span className="text-xs text-muted-foreground">
            Standard 5-field crontab.{' '}
            <span className="font-mono">0 9 * * 1</span> means every Monday at 09:00.
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
  onChange:   (c: AutomationCondition[]) => void;
}) {
  const add    = () => onChange([...conditions, { type: 'FIELD_EQUALS', field: 'priority', value: 'HIGH' } as any]);
  const remove = (i: number) => onChange(conditions.filter((_, idx) => idx !== i));
  const update = (i: number, patch: Partial<AutomationCondition>) =>
    onChange(conditions.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border/60 bg-muted/20 p-3">
      <div className="flex items-center justify-between">
        <SectionTitle
          icon={CircleDot}
          title="If"
          hint="(all conditions must match — leave empty to fire on every event)"
        />
        <Button type="button" size="sm" variant="ghost" onClick={add} className="h-7 px-2 text-xs">
          <Plus className="size-3.5" /> Add condition
        </Button>
      </div>

      {conditions.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">
          No conditions — rule fires for all events.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {conditions.map((cond, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <Select
                value={(cond as any).type}
                onValueChange={(v) => update(i, { type: v as AutomationConditionType } as any)}
              >
                <SelectTrigger className="h-8 w-[170px] text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(CONDITION_LABELS) as AutomationConditionType[]).map((t) => (
                    <SelectItem key={t} value={t}>{CONDITION_LABELS[t]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {((cond as any).type === 'FIELD_EQUALS' || (cond as any).type === 'FIELD_NOT_EQUALS') && (
                <>
                  <Input
                    placeholder="field"
                    value={(cond as any).field ?? ''}
                    onChange={(e) => update(i, { field: e.target.value } as any)}
                    className="h-8 w-[140px] text-xs"
                  />
                  <Input
                    placeholder="value"
                    value={(cond as any).value ?? ''}
                    onChange={(e) => update(i, { value: e.target.value } as any)}
                    className="h-8 flex-1 min-w-[120px] text-xs"
                  />
                </>
              )}
              {((cond as any).type === 'IN_SPRINT' || (cond as any).type === 'NOT_IN_SPRINT') && (
                <Input
                  placeholder="Sprint name or ID (optional)"
                  value={(cond as any).value ?? ''}
                  onChange={(e) => update(i, { value: e.target.value } as any)}
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
  actions:  AutomationAction[];
  onChange: (a: AutomationAction[]) => void;
}) {
  const add    = () => onChange([...actions, { type: 'SEND_NOTIFICATION', message: '' } as any]);
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
            <div
              key={i}
              className="rounded-md border border-border/40 bg-card p-2.5 flex flex-col gap-2"
            >
              <div className="flex items-center gap-2">
                <Select
                  value={(action as any).type}
                  onValueChange={(v) => update(i, { type: v as AutomationActionType } as any)}
                >
                  <SelectTrigger className="h-8 flex-1 text-xs"><SelectValue /></SelectTrigger>
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

              {(action as any).type === 'TRANSITION_ISSUE' && (
                <Input
                  placeholder="Target status name"
                  value={(action as any).toStatus ?? ''}
                  onChange={(e) => update(i, { toStatus: e.target.value } as any)}
                  className="h-8 text-xs"
                />
              )}
              {(action as any).type === 'ASSIGN_ISSUE' && (
                <Input
                  placeholder='User ID or "REPORTER"'
                  value={(action as any).assigneeId ?? ''}
                  onChange={(e) => update(i, { assigneeId: e.target.value } as any)}
                  className="h-8 text-xs font-mono"
                />
              )}
              {(action as any).type === 'SET_PRIORITY' && (
                <Select
                  value={(action as any).priority ?? 'MEDIUM'}
                  onValueChange={(v) => update(i, { priority: v } as any)}
                >
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PRIORITIES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
              {((action as any).type === 'ADD_COMMENT' || (action as any).type === 'SEND_NOTIFICATION') && (
                <textarea
                  placeholder="Message"
                  value={(action as any).message ?? ''}
                  onChange={(e) => update(i, { message: e.target.value } as any)}
                  rows={2}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:border-ring resize-none"
                />
              )}
              {(action as any).type === 'TRIGGER_WEBHOOK' && (
                <Input
                  type="url"
                  placeholder="https://hooks.example.com/…"
                  value={(action as any).webhookUrl ?? ''}
                  onChange={(e) => update(i, { webhookUrl: e.target.value } as any)}
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
  icon:   typeof Zap;
  label:  string;
  value:  number;
  tone?:  KpiTone;
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
          Automate repetitive work — auto-assign issues, transition them when criteria are met,
          send notifications, or call webhooks.
        </div>
      </div>
      <Button size="sm" variant="primary" onClick={onCreate}>
        <Plus className="size-4" /> Create your first rule
      </Button>
    </div>
  );
}

// Exported for loading.tsx reuse
export function AutomationsSkeleton() {
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
