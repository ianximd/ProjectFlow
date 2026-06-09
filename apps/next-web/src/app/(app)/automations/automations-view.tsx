'use client';

import { useMemo, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import {
  Zap, Plus, Search, Filter, X, Edit3, Trash2,
  Power, History, Activity, Wand2, CircleDot, Pause, Play, CalendarClock,
} from 'lucide-react';

import type {
  AutomationRule,
  AutomationTemplate,
  AutomationTriggerType,
  AutomationActionType,
  AutomationConditionType,
  AutomationTriggerConfig,
  AutomationCondition,
  AutomationAction,
  ConditionNode,
  ConditionLeaf,
  ConditionOperator,
} from '@projectflow/types';
import { TemplateGallery } from './TemplateGallery';
import { RunHistoryDrawer } from './RunHistoryDrawer';

import { parseConditionTreeClient, emptyLeaf, emptyGroup, isGroup, countLeaves } from '@/lib/conditionTree';
import { notifyActionError } from '@/lib/apiErrorToast';
import { formatShortDate } from '@/lib/date';
import {
  createAutomation,
  updateAutomation,
  toggleAutomation,
  deleteAutomation,
} from '@/server/actions/automations';
import {
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

// ── Label key maps (resolved via t() inside components) ───────────────────────

export const TRIGGER_KEYS: Record<AutomationTriggerType, string> = {
  TASK_CREATED:     'triggerTaskCreated',
  TASK_UPDATED:     'triggerTaskUpdated',
  STATUS_CHANGED:   'triggerStatusChanged',
  FIELD_CHANGED:    'triggerFieldChanged',
  ASSIGNEE_CHANGED: 'triggerAssigneeChanged',
  COMMENT_POSTED:   'triggerCommentPosted',
  SPRINT_STARTED:   'triggerSprintStarted',
  SPRINT_COMPLETED: 'triggerSprintCompleted',
  DUE_DATE_PASSED:  'triggerDueDatePassed',
  DATE_ARRIVED:     'triggerDateArrived',
  SCHEDULED:        'triggerScheduled',
  MANUAL:           'triggerManual',
  WEBHOOK:          'triggerWebhook',
};

const ACTION_KEYS: Record<AutomationActionType, string> = {
  CHANGE_STATUS:     'actionChangeStatus',
  ASSIGN:            'actionAssign',
  UNASSIGN:          'actionUnassign',
  SET_PRIORITY:      'actionSetPriority',
  POST_COMMENT:      'actionPostComment',
  SEND_NOTIFICATION: 'actionSendNotification',
  CALL_WEBHOOK:      'actionCallWebhook',
  SET_FIELD:         'actionSetField',
  ADD_TAG:           'actionAddTag',
  CREATE_TASK:       'actionCreateTask',
  CREATE_SUBTASK:    'actionCreateSubtask',
  MOVE_TASK:         'actionMoveTask',
  APPLY_TEMPLATE:    'actionApplyTemplate',
};

const CONDITION_KEYS: Record<AutomationConditionType, string> = {
  ISSUE_MATCHES_FILTER: 'conditionIssueMatchesFilter',
  FIELD_EQUALS:         'conditionFieldEquals',
  FIELD_NOT_EQUALS:     'conditionFieldNotEquals',
  USER_HAS_ROLE:        'conditionUserHasRole',
  IN_SPRINT:            'conditionInSprint',
  NOT_IN_SPRINT:        'conditionNotInSprint',
};

const OPERATOR_KEYS: Record<string, string> = {
  is: 'operatorIs', is_not: 'operatorIsNot', contains: 'operatorContains',
  gt: 'operatorGt', lt: 'operatorLt', before: 'operatorBefore', after: 'operatorAfter', is_set: 'operatorIsSet',
};
const GROUP_OP_KEYS: Record<'AND' | 'OR', string> = { AND: 'groupAll', OR: 'groupAny' };
const OPERATORS = ['is', 'is_not', 'contains', 'gt', 'lt', 'before', 'after', 'is_set'] as const;

const PRIORITIES = ['HIGHEST', 'HIGH', 'MEDIUM', 'LOW', 'LOWEST'] as const;

const WEBHOOK_EVENTS = [
  'automation.fired',
  'issue.created',
  'issue.updated',
  'issue.deleted',
  'sprint.started',
  'sprint.completed',
  'comment.created',
  'member.invited',
] as const;

// ── Helpers ───────────────────────────────────────────────────────────────────

function shortDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return null;
  return formatShortDate(d);
}

const DEFAULT_TRIGGER: AutomationTriggerConfig = { type: 'TASK_CREATED' };

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  ctx:             WorkspaceProjectContext;
  automations:     Automation[];
  templates:       AutomationTemplate[];
  usageRunCount:   number | null;
}

// ── Prefill shape for RuleDialog ──────────────────────────────────────────────
interface RulePrefill {
  name:       string;
  trigger:    AutomationTriggerConfig;
  conditions: AutomationCondition[] | ConditionNode;
  actions:    AutomationAction[];
}

// ── View ──────────────────────────────────────────────────────────────────────

export function AutomationsView({ ctx, automations, templates, usageRunCount }: Props) {
  const t = useTranslations('Automations');
  const [isPending, startTransition] = useTransition();

  const [search,        setSearch]        = useState('');
  const [enabledFilter, setEnabledFilter] = useState<'ALL' | 'ENABLED' | 'DISABLED'>('ALL');
  const [editing,       setEditing]       = useState<Automation | null>(null);
  const [createOpen,    setCreateOpen]    = useState(false);

  // Template gallery + run-history drawer state
  const [galleryOpen,  setGalleryOpen]  = useState(false);
  const [historyRule,  setHistoryRule]  = useState<Automation | null>(null);
  const [prefill,      setPrefill]      = useState<RulePrefill | null>(null);
  // Bumped on every create-dialog open so RuleDialog remounts and re-runs its
  // useState seeders (the form is seeded ONLY in those initializers; without a
  // remount the create dialog keeps whatever state it first mounted with).
  const [createSeq,    setCreateSeq]    = useState(0);

  // Create/edit error state
  const [saveError,   setSaveError]   = useState<string | null>(null);
  const [isSaving,    setIsSaving]    = useState(false);

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
    if (!window.confirm(t('deleteConfirm', { name }))) return;
    startTransition(async () => {
      const res = await deleteAutomation(id);
      if (!res.ok) notifyActionError(res);
    });
  }

  // ── Template gallery ────────────────────────────────────────────────────────
  function handleUseTemplate(tpl: AutomationTemplate) {
    setPrefill({
      name:       tpl.title ?? '',
      trigger:    tpl.trigger,
      conditions: tpl.conditions,
      actions:    tpl.actions,
    });
    setGalleryOpen(false);
    setCreateSeq((s) => s + 1);   // remount RuleDialog so it re-seeds from the prefill
    setCreateOpen(true);
  }

  // Open an EMPTY create dialog (no template). Clear any prior prefill and bump
  // the seq so RuleDialog remounts fresh.
  function openCreateBlank() {
    setPrefill(null);
    setCreateSeq((s) => s + 1);
    setCreateOpen(true);
  }

  async function handleSave(input: {
    name:       string;
    trigger:    AutomationTriggerConfig;
    conditions: AutomationCondition[] | ConditionNode;
    actions:    AutomationAction[];
    scopeType:  'PROJECT' | 'WORKSPACE';
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
          scopeType:   input.scopeType,
          workspaceId: ctx.activeWorkspaceId,
          projectId:   input.scopeType === 'WORKSPACE' ? null : ctx.activeProjectId,
          name:        input.name,
          trigger:     input.trigger,
          conditions:  input.conditions,
          actions:     input.actions,
        });
      }
      if (!res.ok) {
        setSaveError(res.error);
        notifyActionError(res);
      } else {
        setEditing(null);
        setCreateOpen(false);
        setPrefill(null);
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
              <span>{t('breadcrumb')}</span>
              {(activeProject as any)?.key && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono">{(activeProject as any).key}</span>
                </>
              )}
            </div>
            <h2 className="text-base font-semibold text-foreground truncate">
              {activeProject?.name ?? t('noProject')}
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
            variant="outline"
            onClick={() => setGalleryOpen(true)}
          >
            <Wand2 className="size-4" /> {t('galleryButton')}
          </Button>
          <Button
            size="sm"
            variant="primary"
            onClick={openCreateBlank}
            disabled={!ctx.activeProjectId}
          >
            <Plus className="size-4" /> {t('newRule')}
          </Button>
        </div>
      </div>

      {noProject ? (
        <EmptyProjectState />
      ) : (
        <>
          {/* ── KPI tiles ──────────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KpiTile icon={Zap}      label={t('kpiTotalRules')} value={kpi.total}    tone="default" />
            <KpiTile icon={Play}     label={t('kpiEnabled')}    value={kpi.enabled}  tone="success" />
            <KpiTile icon={Pause}    label={t('kpiDisabled')}   value={kpi.disabled} tone="muted" />
            <KpiTile icon={Activity} label={t('kpiTotalRuns')}  value={kpi.runs}     tone="info" />
            {usageRunCount !== null && (
              <KpiTile icon={CalendarClock} label={t('kpiRunsThisMonth')} value={usageRunCount} tone="info" />
            )}
          </div>

          {/* ── Filter bar ────────────────────────────────────────────────── */}
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/30 p-2">
            <div className="relative flex-1 min-w-[180px]">
              <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('filterSearchPlaceholder')}
                className="h-8 pl-7 text-xs"
                aria-label={t('filterSearchAriaLabel')}
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
                <SelectItem value="ALL">{t('filterAllRules')}</SelectItem>
                <SelectItem value="ENABLED">{t('filterEnabledOnly')}</SelectItem>
                <SelectItem value="DISABLED">{t('filterDisabledOnly')}</SelectItem>
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
                  <X className="size-3.5" /> {t('filterClear')}
                </Button>
              </>
            )}
            <div className="ml-auto text-xs text-muted-foreground">
              {t('showingOf', { shown: filteredRules.length, total: automations.length })}
            </div>
          </div>

          {/* ── Rule list ─────────────────────────────────────────────────── */}
          {automations.length === 0 ? (
            <EmptyRulesState onCreate={openCreateBlank} />
          ) : filteredRules.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
              {t('noMatchFilters')}
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
                  onHistory={() => setHistoryRule(r)}
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* ── Dialogs ─────────────────────────────────────────────────────────── */}
      <RuleDialog
        key={`create-${createSeq}`}
        mode="create"
        open={createOpen}
        initial={null}
        prefill={prefill}
        onClose={() => { setCreateOpen(false); setSaveError(null); setPrefill(null); }}
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

      <TemplateGallery
        open={galleryOpen}
        templates={templates}
        onClose={() => setGalleryOpen(false)}
        onUse={handleUseTemplate}
      />

      <RunHistoryDrawer
        open={!!historyRule}
        ruleId={historyRule?.id ?? ''}
        ruleName={historyRule?.name ?? ''}
        onClose={() => setHistoryRule(null)}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Rule row
// ─────────────────────────────────────────────────────────────────────────────

function RuleRow({
  rule, busy, onToggle, onEdit, onDelete, onHistory,
}: {
  rule:      Automation;
  busy:      boolean;
  onToggle:  () => void;
  onEdit:    () => void;
  onDelete:  () => void;
  onHistory: () => void;
}) {
  const t = useTranslations('Automations');
  const lastRun = shortDate(rule.lastExecutedAt as string | null);
  const trigger = rule.trigger as AutomationTriggerConfig | null;
  const conditionCount = countLeaves(rule.conditions as AutomationCondition[] | ConditionNode);
  const actions    = rule.actions    as AutomationAction[];

  return (
    <Card className={cn('p-4 transition-colors', !rule.isEnabled && 'opacity-70')}>
      <div className="flex items-start gap-3">
        <div className="pt-0.5 shrink-0">
          <Switch
            checked={rule.isEnabled}
            onCheckedChange={onToggle}
            disabled={busy}
            aria-label={rule.isEnabled ? t('disableAriaLabel') : t('enableAriaLabel')}
          />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-semibold text-foreground truncate">{rule.name}</h3>
            {rule.isEnabled
              ? <Badge size="xs" variant="outline" appearance="outline" className="bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">{t('enabledBadge')}</Badge>
              : <Badge size="xs" variant="outline" appearance="outline" className="bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400">{t('disabledBadge')}</Badge>}
          </div>

          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {trigger && (
              <Badge size="xs" variant="outline" appearance="outline" className="bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
                <Wand2 className="size-3 mr-1" />
                {t((TRIGGER_KEYS[trigger.type as AutomationTriggerType] ?? trigger.type) as Parameters<typeof t>[0])}
                {trigger.type === 'STATUS_CHANGED' && (trigger as any).toStatus && ` → ${(trigger as any).toStatus}`}
                {trigger.type === 'SCHEDULED' && (trigger as any).cron && ` · ${(trigger as any).cron}`}
              </Badge>
            )}

            {conditionCount > 0 && (
              <Badge size="xs" variant="outline" appearance="outline">
                <CircleDot className="size-3 mr-1" />
                {t('conditionCount', { count: conditionCount })}
              </Badge>
            )}

            {actions.map((a, i) => (
              <Badge key={i} size="xs" variant="outline" appearance="outline" className="font-normal">
                {t((ACTION_KEYS[a.type as AutomationActionType] ?? a.type) as Parameters<typeof t>[0])}
              </Badge>
            ))}
          </div>

          <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Activity className="size-3" />
              {t('runsCount', { count: rule.executionCount as number })}
            </span>
            {lastRun && (
              <span className="inline-flex items-center gap-1">
                <History className="size-3" /> {t('lastRun', { date: lastRun })}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <Button size="sm" variant="ghost" onClick={onHistory} aria-label={t('historyButton')} title={t('historyButton')}>
            <History className="size-3.5" />
          </Button>
          <Button size="sm" variant="ghost" onClick={onEdit} aria-label={t('editAriaLabel')}>
            <Edit3 className="size-3.5" />
          </Button>
          <Button
            size="sm" variant="ghost"
            onClick={onDelete} disabled={busy}
            aria-label={t('deleteAriaLabel')}
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
  mode, open, initial, prefill, onClose, onSubmit, isPending, error,
}: {
  mode:      'create' | 'edit';
  open:      boolean;
  initial:   Automation | null;
  /** When mode==='create' and no initial, seed the form from this template prefill. */
  prefill?:  RulePrefill | null;
  onClose:   () => void;
  onSubmit:  (input: {
    name:       string;
    trigger:    AutomationTriggerConfig;
    conditions: AutomationCondition[] | ConditionNode;
    actions:    AutomationAction[];
    scopeType:  'PROJECT' | 'WORKSPACE';
  }) => void;
  isPending: boolean;
  error:     string | null;
}) {
  const seed = mode === 'create' && !initial && prefill ? prefill : null;
  const [name,       setName]       = useState(initial?.name ?? seed?.name ?? '');
  const [scopeType,  setScopeType]  = useState<'PROJECT' | 'WORKSPACE'>('PROJECT');
  const [trigger,    setTrigger]    = useState<AutomationTriggerConfig>(
    (initial?.trigger as AutomationTriggerConfig) ?? seed?.trigger ?? DEFAULT_TRIGGER,
  );
  const [conditionTree, setConditionTree] = useState<ConditionNode>(
    parseConditionTreeClient(
      (initial?.conditions as AutomationCondition[] | ConditionNode | undefined)
        ?? (seed?.conditions as AutomationCondition[] | ConditionNode | undefined),
    ),
  );
  const [actions,    setActions]    = useState<AutomationAction[]>(
    (initial?.actions as AutomationAction[]) ?? seed?.actions ?? [],
  );

  const canSubmit = name.trim().length > 0 && actions.length > 0 && !isPending;

  const t = useTranslations('Automations');
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent key={initial?.id ?? mode} className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {mode === 'create' ? t('dialogCreateTitle') : t('dialogEditTitle', { name: initial?.name ?? '' })}
          </DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit({ name: name.trim(), trigger, conditions: conditionTree, actions, scopeType });
          }}
        >
          <DialogBody className="flex flex-col gap-5 max-h-[60vh] overflow-y-auto">
            {/* Name */}
            <div className="flex flex-col gap-1.5">
              <label htmlFor="rule-name" className="text-xs font-medium text-muted-foreground">
                {t('nameLabel')}
              </label>
              <Input
                id="rule-name"
                required
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('namePlaceholder')}
              />
            </div>

            {/* Scope */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">{t('scopeLabel')}</label>
              <Select value={scopeType} onValueChange={(v) => setScopeType(v as 'PROJECT' | 'WORKSPACE')}>
                <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="PROJECT">{t('scopeThisProject')}</SelectItem>
                  <SelectItem value="WORKSPACE">{t('scopeEntireWorkspace')}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Trigger */}
            <TriggerEditor trigger={trigger} onChange={setTrigger} />

            {/* Conditions */}
            <ConditionGroupEditor node={conditionTree} onChange={setConditionTree} root />

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
              {t('cancelButton')}
            </Button>
            <Button type="submit" variant="primary" disabled={!canSubmit}>
              {isPending ? t('saving') : mode === 'create' ? t('createRule') : t('saveChanges')}
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
  const t = useTranslations('Automations');
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border/60 bg-muted/20 p-3">
      <SectionTitle icon={Wand2} title={t('whenTitle')} />
      <Select
        value={trigger.type}
        onValueChange={(v) => onChange({ ...trigger, type: v as AutomationTriggerType })}
      >
        <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
        <SelectContent>
          {(Object.keys(TRIGGER_KEYS) as AutomationTriggerType[]).map((k) => (
            <SelectItem key={k} value={k}>{t(TRIGGER_KEYS[k] as Parameters<typeof t>[0])}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {trigger.type === 'STATUS_CHANGED' && (
        <Input
          placeholder={t('transitionToStatusPlaceholder')}
          value={(trigger as any).toStatus ?? ''}
          onChange={(e) => onChange({ ...trigger, toStatus: e.target.value || undefined } as any)}
          className="h-9 text-sm"
        />
      )}
      {trigger.type === 'DUE_DATE_PASSED' && (
        <Input
          type="number" min={0}
          placeholder={t('hoursBeforeDuePlaceholder')}
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
            placeholder={t('cronPlaceholder')}
            value={(trigger as any).cron ?? ''}
            onChange={(e) => onChange({ ...trigger, cron: e.target.value || undefined } as any)}
            className="h-9 text-sm font-mono"
          />
          <span className="text-xs text-muted-foreground">
            {t('cronHint')}{' '}
            <span className="font-mono">{t('cronExample')}</span>{' '}{t('cronExampleMeaning')}
          </span>
        </div>
      )}
    </div>
  );
}

function ConditionGroupEditor({
  node, onChange, root = false,
}: {
  node:     ConditionNode;
  onChange: (n: ConditionNode) => void;
  root?:    boolean;
}) {
  const t = useTranslations('Automations');
  if (!isGroup(node)) {
    return (
      <ConditionLeafEditor
        leaf={node as ConditionLeaf}
        onChange={onChange}
        onRemove={() => onChange(emptyGroup('AND'))}
      />
    );
  }
  const group = node;
  const setOp = (op: 'AND' | 'OR') => onChange({ ...group, op });
  const addLeaf = () => onChange({ ...group, children: [...group.children, emptyLeaf()] });
  const addGroup = () => onChange({ ...group, children: [...group.children, emptyGroup(group.op === 'AND' ? 'OR' : 'AND')] });
  const updateChild = (i: number, child: ConditionNode) =>
    onChange({ ...group, children: group.children.map((c, idx) => (idx === i ? child : c)) });
  const removeChild = (i: number) =>
    onChange({ ...group, children: group.children.filter((_, idx) => idx !== i) });

  return (
    <div className={cn('flex flex-col gap-2 rounded-md border border-border/60 p-3', root ? 'bg-muted/20' : 'bg-card/60 ml-3')}>
      {root && <SectionTitle icon={CircleDot} title={t('ifTitle')} hint={t('ifHint')} />}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Select value={group.op} onValueChange={(v) => setOp(v as 'AND' | 'OR')}>
            <SelectTrigger className="h-7 w-[140px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="AND">{t(GROUP_OP_KEYS.AND as Parameters<typeof t>[0])}</SelectItem>
              <SelectItem value="OR">{t(GROUP_OP_KEYS.OR as Parameters<typeof t>[0])}</SelectItem>
            </SelectContent>
          </Select>
          <Button type="button" size="sm" variant="ghost" onClick={addLeaf} className="h-7 px-2 text-xs"><Plus className="size-3.5" /> {t('addCondition')}</Button>
          <Button type="button" size="sm" variant="ghost" onClick={addGroup} className="h-7 px-2 text-xs"><Plus className="size-3.5" /> {t('addGroup')}</Button>
        </div>
      </div>
      {group.children.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">{t('noConditions')}</p>
      ) : (
        <div className="flex flex-col gap-2">
          {group.children.map((child, i) => (
            isGroup(child)
              ? <div key={i} className="flex items-start gap-1">
                  <ConditionGroupEditor node={child} onChange={(c) => updateChild(i, c)} />
                  <Button type="button" size="sm" variant="ghost" className="h-8 w-8 p-0 text-destructive" onClick={() => removeChild(i)} aria-label={t('removeConditionAriaLabel')}><X className="size-3.5" /></Button>
                </div>
              : <ConditionLeafEditor key={i} leaf={child as ConditionLeaf} onChange={(c) => updateChild(i, c)} onRemove={() => removeChild(i)} />
          ))}
        </div>
      )}
    </div>
  );
}

function ConditionLeafEditor({
  leaf, onChange, onRemove,
}: {
  leaf:     ConditionLeaf;
  onChange: (l: ConditionLeaf) => void;
  onRemove: () => void;
}) {
  const t = useTranslations('Automations');
  const update = (patch: Partial<ConditionLeaf>) => onChange({ ...leaf, ...patch });
  const isField = leaf.type === 'FIELD_EQUALS' || leaf.type === 'FIELD_NOT_EQUALS';
  const isFilter = leaf.type === 'ISSUE_MATCHES_FILTER';
  const isRole = leaf.type === 'USER_HAS_ROLE';
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select value={leaf.type} onValueChange={(v) => update({ type: v as ConditionLeaf['type'] })}>
        <SelectTrigger className="h-8 w-[170px] text-xs"><SelectValue /></SelectTrigger>
        <SelectContent>
          {(Object.keys(CONDITION_KEYS) as AutomationConditionType[]).map((k) => (
            <SelectItem key={k} value={k}>{t(CONDITION_KEYS[k] as Parameters<typeof t>[0])}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      {isField && (
        <>
          <Input placeholder={t('fieldPlaceholder')} value={leaf.field ?? ''} onChange={(e) => update({ field: e.target.value })} className="h-8 w-[130px] text-xs" />
          <Select value={leaf.operator} onValueChange={(v) => update({ operator: v as ConditionOperator })}>
            <SelectTrigger className="h-8 w-[130px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {OPERATORS.map((op) => <SelectItem key={op} value={op}>{t(OPERATOR_KEYS[op] as Parameters<typeof t>[0])}</SelectItem>)}
            </SelectContent>
          </Select>
          {leaf.operator !== 'is_set' && (
            <Input placeholder={t('valuePlaceholder')} value={leaf.value ?? ''} onChange={(e) => update({ value: e.target.value })} className="h-8 flex-1 min-w-[110px] text-xs" />
          )}
        </>
      )}
      {isFilter && (
        <Input placeholder={t('pqlPlaceholder')} value={leaf.pql ?? ''} onChange={(e) => update({ pql: e.target.value, operator: 'is' })} className="h-8 flex-1 min-w-[160px] text-xs font-mono" />
      )}
      {isRole && (
        <Input placeholder={t('roleSlugPlaceholder')} value={leaf.value ?? ''} onChange={(e) => update({ value: e.target.value, operator: 'is' })} className="h-8 flex-1 min-w-[140px] text-xs font-mono" />
      )}
      <Button type="button" size="sm" variant="ghost" className="h-8 w-8 p-0 text-destructive hover:text-destructive" onClick={onRemove} aria-label={t('removeConditionAriaLabel')}><X className="size-3.5" /></Button>
    </div>
  );
}

function ActionList({
  actions, onChange,
}: {
  actions:  AutomationAction[];
  onChange: (a: AutomationAction[]) => void;
}) {
  const t = useTranslations('Automations');
  const add    = () => onChange([...actions, { type: 'SEND_NOTIFICATION', message: '' } as any]);
  const remove = (i: number) => onChange(actions.filter((_, idx) => idx !== i));
  const update = (i: number, patch: Partial<AutomationAction>) =>
    onChange(actions.map((a, idx) => (idx === i ? { ...a, ...patch } : a)));

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border/60 bg-muted/20 p-3">
      <div className="flex items-center justify-between">
        <SectionTitle icon={Power} title={t('thenTitle')} hint={t('thenHint')} />
        <Button type="button" size="sm" variant="ghost" onClick={add} className="h-7 px-2 text-xs">
          <Plus className="size-3.5" /> {t('addAction')}
        </Button>
      </div>

      {actions.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">{t('noActions')}</p>
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
                    {(Object.keys(ACTION_KEYS) as AutomationActionType[]).map((k) => (
                      <SelectItem key={k} value={k}>{t(ACTION_KEYS[k] as Parameters<typeof t>[0])}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button" size="sm" variant="ghost"
                  className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                  onClick={() => remove(i)}
                  aria-label={t('removeActionAriaLabel')}
                >
                  <X className="size-3.5" />
                </Button>
              </div>

              {(action as any).type === 'CHANGE_STATUS' && (
                <Input
                  placeholder={t('targetStatusPlaceholder')}
                  value={(action as any).toStatus ?? ''}
                  onChange={(e) => update(i, { toStatus: e.target.value } as any)}
                  className="h-8 text-xs"
                />
              )}
              {(action as any).type === 'ASSIGN' && (
                <Input
                  placeholder={t('assigneePlaceholder')}
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
              {((action as any).type === 'POST_COMMENT' || (action as any).type === 'SEND_NOTIFICATION') && (
                <textarea
                  placeholder={t('messagePlaceholder')}
                  value={(action as any).message ?? ''}
                  onChange={(e) => update(i, { message: e.target.value } as any)}
                  rows={2}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:border-ring resize-none"
                />
              )}
              {(action as any).type === 'CALL_WEBHOOK' && (
                <Select
                  value={(action as any).webhookEvent ?? ''}
                  onValueChange={(v) => update(i, { webhookEvent: v } as any)}
                >
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder={t('webhookEventPlaceholder')} /></SelectTrigger>
                  <SelectContent>
                    {WEBHOOK_EVENTS.map((ev) => (
                      <SelectItem key={ev} value={ev}>{ev}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {(action as any).type === 'SET_FIELD' && (
                <>
                  <Input
                    placeholder={t('fieldIdPlaceholder')}
                    value={(action as any).fieldId ?? ''}
                    onChange={(e) => update(i, { fieldId: e.target.value } as any)}
                    className="h-8 text-xs font-mono"
                  />
                  <Input
                    placeholder={t('fieldValuePlaceholder')}
                    value={(action as any).fieldValue ?? ''}
                    onChange={(e) => update(i, { fieldValue: e.target.value } as any)}
                    className="h-8 text-xs"
                  />
                </>
              )}
              {(action as any).type === 'ADD_TAG' && (
                <Input
                  placeholder={t('tagNamePlaceholder')}
                  value={(action as any).tagName ?? ''}
                  onChange={(e) => update(i, { tagName: e.target.value } as any)}
                  className="h-8 text-xs"
                />
              )}
              {((action as any).type === 'CREATE_TASK' || (action as any).type === 'CREATE_SUBTASK') && (
                <Input
                  placeholder={t('newTaskTitlePlaceholder')}
                  value={(action as any).title ?? ''}
                  onChange={(e) => update(i, { title: e.target.value } as any)}
                  className="h-8 text-xs"
                />
              )}
              {(action as any).type === 'MOVE_TASK' && (
                <Input
                  placeholder={t('targetListIdPlaceholder')}
                  value={(action as any).targetListId ?? ''}
                  onChange={(e) => update(i, { targetListId: e.target.value } as any)}
                  className="h-8 text-xs font-mono"
                />
              )}
              {(action as any).type === 'APPLY_TEMPLATE' && (
                <Input
                  placeholder={t('templateIdPlaceholder')}
                  value={(action as any).templateId ?? ''}
                  onChange={(e) => update(i, { templateId: e.target.value } as any)}
                  className="h-8 text-xs font-mono"
                />
              )}
              <Input
                type="number"
                min={0}
                placeholder={t('delaySecondsPlaceholder')}
                value={(action as any).delaySeconds ?? ''}
                onChange={(e) => update(i, { delaySeconds: e.target.value ? Number(e.target.value) : undefined } as any)}
                className="h-8 text-xs"
                aria-label={t('delaySecondsAriaLabel')}
              />
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
  const t = useTranslations('Automations');
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border p-8 text-center">
      <Zap className="size-10 text-muted-foreground/50" aria-hidden="true" />
      <div className="space-y-1">
        <div className="text-sm font-medium text-foreground">{t('emptyProjectTitle')}</div>
        <div className="text-xs text-muted-foreground max-w-sm">
          {t('emptyProjectBody')}
        </div>
      </div>
    </div>
  );
}

function EmptyRulesState({ onCreate }: { onCreate: () => void }) {
  const t = useTranslations('Automations');
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border p-8 text-center">
      <Zap className="size-10 text-muted-foreground/50" aria-hidden="true" />
      <div className="space-y-1">
        <div className="text-sm font-medium text-foreground">{t('emptyRulesTitle')}</div>
        <div className="text-xs text-muted-foreground max-w-sm">
          {t('emptyRulesBody')}
        </div>
      </div>
      <Button size="sm" variant="primary" onClick={onCreate}>
        <Plus className="size-4" /> {t('createFirstRule')}
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
